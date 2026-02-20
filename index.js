 /**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
import mongoose from "mongoose";
import fs from "fs";
import readline from "readline";
import express from "express";

// Safe database disconnection utility
async function safeDisconnect(context = 'UNKNOWN') {
  try {
    if (mongoose.connection.readyState !== 0) { // 0 = disconnected
      await mongoose.disconnect();
    }
  } catch (error) {
    console.log(`[${context}] Database already disconnected or connection error:`, error.message);
  }
}

import { gameFunction } from "./src/gamification.js";
import { MongoDB } from "./src/database.js";
import { getQuestConfig } from "./src/config/questConfigGenerator.js";
import { getGeneralResponses } from "./src/config/responseGenerator.js";
import { ConfigService } from "./src/services/configService.js";
import { priorityQueue } from "./src/services/priorityQueueService.js";
import { deploymentState } from "./src/services/deploymentStateService.js";
import { rateLimitService } from "./src/services/rateLimitService.js";

const questConfig = getQuestConfig();
const responses = getGeneralResponses();

const db = new MongoDB();
await db.connect();

await checkOSSRepo();

// Create Express server for health checks
const app = express();
const HEALTH_PORT = process.env.HEALTH_PORT || 4000;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    service: 'oss-doorway',
    timestamp: new Date().toISOString()
  });
});

// README update endpoint for batch operations
app.post('/api/updateReadme', express.json(), async (req, res) => {
  try {
    const { owner, repo, username } = req.body;
    
    if (!owner || !repo || !username) {
      return res.status(400).json({ 
        error: 'Missing required parameters: owner, repo, username' 
      });
    }
    
    console.log(`📝 [API-README] Updating README for ${owner}/${repo} (user: ${username})`);
    
    // Get user data from database
    await connectToDatabase();
    let dbUser = repo;
    if (repo.includes('-oss-doorway')) {
      dbUser = repo;
    } else if (repo.endsWith('-custom-oss-doorway')) {
      dbUser = repo.replace(/-custom-oss-doorway$/, '');
    }
    
    const user_document = await db.downloadUserData(dbUser);
    if (!user_document) {
      return res.status(404).json({ 
        error: `User data not found for ${dbUser}` 
      });
    }
    
    // Create a mock context with minimal required properties
    const mockContext = {
      octokit: {
        rest: {
          repos: {
            getReadme: async (params) => {
              const { Octokit } = await import('@octokit/rest');
              const { getGithubAppInstallationAccessToken } = await import('./src/utils/githubAppAuth.js');
              const token = await getGithubAppInstallationAccessToken();
              const octokit = new Octokit({ auth: token });
              return await octokit.rest.repos.getReadme(params);
            },
            createOrUpdateFileContents: async (params) => {
              const { Octokit } = await import('@octokit/rest');
              const { getGithubAppInstallationAccessToken } = await import('./src/utils/githubAppAuth.js');
              const token = await getGithubAppInstallationAccessToken();
              const octokit = new Octokit({ auth: token });
              return await octokit.rest.repos.createOrUpdateFileContents(params);
            }
          }
        }
      },
      issue: () => ({ owner, repo })
    };
    
    // Call the updateReadme function
    await gameFunction.updateReadme(owner, repo, mockContext, user_document.user_data, db);
    
    res.status(200).json({ 
      success: true,
      message: `README updated successfully for ${owner}/${repo}`,
      user: username
    });
    
  } catch (error) {
    console.error(`❌ [API-README] Error updating README:`, error);
    res.status(500).json({ 
      error: 'Failed to update README',
      details: error.message 
    });
  }
});

// Add deployment endpoints
import { 
  startDeployment, 
  updateDeployment, 
  completeDeployment, 
  getDeploymentStatus, 
  clearAllDeployments 
} from './src/api/deploymentEndpoints.js';

app.post('/api/deployment/start', startDeployment);
app.post('/api/deployment/update', updateDeployment);
app.post('/api/deployment/complete', completeDeployment);
app.get('/api/deployment/status', getDeploymentStatus);
app.post('/api/deployment/clear', clearAllDeployments);

console.log('🚀 [API] Deployment endpoints registered');

// Start the health check server on a different port
app.listen(HEALTH_PORT, () => {
  console.log(`🏥 Health check server running on port ${HEALTH_PORT}`);
});


export default (app) => {
  // Sync deployment state with priority queue and rate limiter
  setInterval(() => {
    const isDeploymentActive = deploymentState.isAnyDeploymentInProgress();
    priorityQueue.setDeploymentInProgress(isDeploymentActive);
    rateLimitService.setDeploymentMode(isDeploymentActive);
    
    // Log status every 30 seconds during deployments
    if (isDeploymentActive) {
      const stats = deploymentState.getStats();
      console.log(`🟣 [DEPLOYMENT-SYNC] Active deployments: ${stats.activeCount}`);
      priorityQueue.logStatus();
      rateLimitService.logStatus();
    }
  }, 30000); // Check every 30 seconds

  app.on("issues.opened", async (context) => {
    const { owner, repo } = context.repo();
    if (context.payload.issue.user.type === "Bot") return;
    // edge case: OSS repo also under user/org
    if (owner + "/" + repo == process.env.OSS_REPO) return;
    
    // Check if issue mentions class admin or self
    const issueTitle = context.payload.issue.title;
    const issueBody = context.payload.issue.body || '';
    const issueAuthor = context.payload.issue.user.login;
    const combinedText = `${issueTitle} ${issueBody}`;
    
    const shouldIgnore = await shouldIgnoreMention(context, combinedText, issueAuthor);
    if (shouldIgnore) {
      console.log(`[OSS-Doorway] Ignoring issue with class admin or self mention: ${issueTitle.substring(0, 50)}...`);
      return;
    }
    
    const user = context.payload.issue.user;
    const issueComment = context.issue({
      body: responses.newIssue,
    });

    try {
      context.octokit.rest.issues.createComment(issueComment);
    } catch (error) {
      console.error("Error commenting: ", error);
    }

    return;
  });
  app.on("issue_comment.created", async (context) => {
    const user = context.payload.comment.user.login;
    const { owner, repo } = context.repo();
    // edge case: OSS repo also under user/org
    if (owner + "/" + repo == process.env.OSS_REPO) return;
    const comment = context.payload.comment.body;

    // Check if comment mentions class admin or self
    const shouldIgnore = await shouldIgnoreMention(context, comment, user);
    if (shouldIgnore) {
      console.log(`[OSS-Doorway] Ignoring comment with class admin or self mention: ${comment.substring(0, 50)}...`);
      return;
    }

    // --- NEW LOGIC: extract dbUser from repo name ---
    // For custom repos created by createCustomRepos, the full repo name is the database key
    // For legacy repos, we need to handle both formats
    let dbUser = repo;
    
    // Check if this is a custom repo (created by createCustomRepos)
    // Custom repos have the format: username-sequenceId-oss-doorway
    if (repo.includes('-oss-doorway')) {
      // Use the full repo name as the database key for custom repos
      dbUser = repo;
    } else if (repo.endsWith('-custom-oss-doorway')) {
      // Legacy format - remove the -custom-oss-doorway suffix
      dbUser = repo.replace(/-custom-oss-doorway$/, '');
    }
    // --- END NEW LOGIC ---

    // admin commands
    if (comment.startsWith("/")) {
      // Special handling for markascompleted and updatereadme - allow users to update their own repos
      if (comment.trim() === "/markascompleted" || comment.trim() === "/updatereadme") {
        // Allow these commands for all users (they can only affect their own repos)
        await parseCommand(context, owner, comment);
      } else if (comment.startsWith("/bypass")) {
        // Special handling for bypass - allow only admins
        if (await isClassAdmin(context, owner, user)) {
          // Check if bypass command has the correct format: /bypass Q1 T1, /bypass Q1 (quest only), or just /bypass (case-insensitive)
          const bypassMatch = comment.trim().match(/^\/bypass\s+(q\d+)\s+(t\d+)$/i);
          const questBypassMatch = comment.trim().match(/^\/bypass\s+(q\d+)$/i);
          const simpleBypassMatch = comment.trim().match(/^\/bypass$/i);
          
          if (bypassMatch || questBypassMatch || simpleBypassMatch) {
            await parseCommand(context, owner, comment);
          } else {
            issueComment(context, "❌ Invalid bypass format. Use: `/bypass` (current task), `/bypass Q1` (entire quest), or `/bypass Q1 T1` (specific task)");
          }
        } else {
          issueComment(context, "Access denied. Only class admins can use bypass commands.");
        }
      } else if (await isAdmin(context, owner, user) || context.payload.comment.user.type === "Bot") {
        // Other admin commands require admin permissions
        await parseCommand(context, owner, comment);
      } else {
        issueComment(context, "You need to be a repo or org owner to run / commands.");
      }
    } 
    else if (comment.toLowerCase().trim() === "help"){
      // Queue help requests as MEDIUM priority
      await priorityQueue.enqueue('MEDIUM', async () => {
        try{
          await connectToDatabase();
          var user_document = await db.downloadUserData(dbUser);
          const hintResponse = await gameFunction.giveHint(user_document.user_data, context, db);
          if (hintResponse && typeof hintResponse === 'string') {
            // If giveHint returns a string, post it as a comment
            await context.octokit.rest.issues.createComment({
              owner: context.payload.repository.owner.login,
              repo: context.payload.repository.name,
              issue_number: context.payload.issue.number,
              body: hintResponse
            });
          }
          await db.updateData(user_document);
          try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
        }
        catch (error) {
          console.log('[HELP] Error processing help request:', error);
          // Post error message to user
          await context.octokit.rest.issues.createComment({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            issue_number: context.payload.issue.number,
            body: '❌ **Error Processing Help Request**\n\nSorry, there was an error processing your help request. Please try again or contact support if the issue persists.'
          });
          try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
        }
      }, {
        type: 'help_request',
        user: user,
        repo: repo
      });
    }
    else if (comment.toLowerCase().trim() === "hint"){
      // Queue hint requests as MEDIUM priority
      await priorityQueue.enqueue('MEDIUM', async () => {
        try{
          await connectToDatabase();
          var user_document = await db.downloadUserData(dbUser);
          await gameFunction.giveHint(user_document.user_data, context, db);
          db.updateData(user_document);
          try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
        }
        catch (error) {
          console.log(error);
          throw error;
        }
      }, {
        type: 'hint_request',
        user: user,
        repo: repo
      });
    }

    // quest response - HIGH PRIORITY (student validation)
    else {
      if (context.payload.comment.user.type === "Bot") return;
      
      // Queue student validation as HIGH priority
      await priorityQueue.enqueue('HIGH', async () => {
        try {
          await connectToDatabase();
          var user_document = await db.downloadUserData(dbUser);
          await gameFunction.validateTask(user_document.user_data, context, user, db);
          db.updateData(user_document);
          try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
        } catch (error) {
          issueComment(
            context,
            "user " +
              dbUser +
              " commented but does not yet exist in database. /new_user <user>"
          );
          console.log(error);
          throw error; // Re-throw for queue error handling
        }
      }, {
        type: 'student_validation',
        user: user,
        repo: repo,
        comment: comment.substring(0, 50) + '...'
      });
    }
  });

  // Handle PR synchronize events (new commits pushed to PR)
  // This enables auto-review for iterative-code-review tasks without requiring "done" command
  app.on("pull_request.synchronize", async (context) => {
    const pr = context.payload.pull_request;
    const sender = context.payload.sender; // Person who pushed the commits
    const user = pr.user.login; // PR creator
    const { owner, repo } = context.repo();
    const prNumber = pr.number;
    
    console.log(`[PR-SYNC] PR #${prNumber} synchronized in ${owner}/${repo} by ${sender.login} (PR creator: ${user})`);
    
    // Ignore pushes from bots (check sender, not PR creator)
    if (sender.type === "Bot") {
      console.log(`[PR-SYNC] Ignoring bot push to PR #${prNumber}`);
      return;
    }
    
    // Ignore if this is in the OSS repo itself
    if (owner + "/" + repo == process.env.OSS_REPO) {
      console.log(`[PR-SYNC] Ignoring PR in OSS repo`);
      return;
    }
    
    // Extract dbUser from repo name (same logic as issue_comment)
    let dbUser = repo;
    if (repo.includes('-oss-doorway')) {
      dbUser = repo;
    } else if (repo.endsWith('-custom-oss-doorway')) {
      dbUser = repo.replace(/-custom-oss-doorway$/, '');
    }
    
    try {
      await connectToDatabase();
      const user_document = await db.downloadUserData(dbUser);
      
      if (!user_document || !user_document.user_data) {
        console.log(`[PR-SYNC] No user data found for ${dbUser}`);
        return;
      }
      
      const user_data = user_document.user_data;
      
      // Check if this PR is associated with an iterative-code-review task
      if (user_data.storedValues?.codeReviewState) {
        for (const [questId, questData] of Object.entries(user_data.storedValues.codeReviewState)) {
          if (questData && typeof questData === 'object') {
            for (const [taskId, taskState] of Object.entries(questData)) {
              if (taskState && typeof taskState === 'object' && taskState.prInfo) {
                if (taskState.prInfo.prNumber === prNumber && 
                    taskState.prInfo.owner === owner && 
                    taskState.prInfo.repo === repo) {
                  console.log(`[PR-SYNC] Found matching iterative-code-review task: ${questId}.${taskId}`);
                  
                  // Check if task is already completed
                  if (taskState.status === 'approved' || taskState.status === 'completed') {
                    console.log(`[PR-SYNC] Task ${questId}.${taskId} already completed, skipping review`);
                    return;
                  }
                  
                  // Trigger review by simulating a "done" command on the PR
                  // Create a minimal comment event to trigger handleIterativeCodeReview
                  const mockCommentContext = {
                    ...context,
                    payload: {
                      ...context.payload,
                      comment: {
                        user: { login: user },
                        body: 'done' // Simulate "done" command
                      },
                      issue: {
                        number: prNumber,
                        title: pr.title
                      },
                      repository: context.payload.repository
                    },
                    issue: () => ({ issue_number: prNumber }),
                    repo: () => ({ owner, repo }) // Add proper repo() function
                  };
                  
                  console.log(`[PR-SYNC] Auto-triggering review for ${questId}.${taskId} on PR #${prNumber}`);
                  
                  // Call gameFunction to trigger the review
                  await priorityQueue.enqueue('HIGH', async () => {
                    try {
                      const currentQuestIndex = user_data.current?.currentQuest || 0;
                      const currentTaskIndex = user_data.current?.currentTask || 0;
                      
                      // Set current quest/task to match the PR's task
                      user_data.current = {
                        currentQuest: parseInt(questId.replace('Q', '')) - 1,
                        currentTask: parseInt(taskId.replace('T', '')) - 1
                      };
                      
                      await gameFunction.validateTask(user_data, mockCommentContext, user, db);
                      await db.updateData(user_document);
                      
                      // Restore original current quest/task
                      user_data.current = {
                        currentQuest: currentQuestIndex,
                        currentTask: currentTaskIndex
                      };
                      
                      await safeDisconnect('PR-SYNC');
                    } catch (error) {
                      console.error(`[PR-SYNC] Error processing PR review:`, error);
                      await safeDisconnect('PR-SYNC-ERROR');
                    }
                  }, {
                    type: 'pr_sync_review',
                    user: user,
                    repo: repo,
                    prNumber: prNumber,
                    quest: questId,
                    task: taskId
                  });
                  
                  return; // Found the task, no need to continue searching
                }
              }
            }
          }
        }
      }
      
      console.log(`[PR-SYNC] No matching iterative-code-review task found for PR #${prNumber}`);
      await safeDisconnect('PR-SYNC-NO-MATCH');
      
    } catch (error) {
      console.error(`[PR-SYNC] Error processing PR synchronize event:`, error);
      await safeDisconnect('PR-SYNC-ERROR');
    }
  });

  // Cache monitoring via console logging (Probot doesn't support HTTP routes directly)
  // Cache statistics are available via ConfigService.getCacheStats()
  // Cache management is available via ConfigService methods
  console.log('📊 [CACHE] Cache monitoring available via ConfigService methods:');
  console.log('  - ConfigService.getCacheStats() - Get cache statistics');
  console.log('  - ConfigService.logCacheStatus() - Log current cache status');
  console.log('  - ConfigService.clearCache() - Clear all cache');
  console.log('  - ConfigService.deleteCacheKey(groupId) - Delete specific entry');
};

async function connectToDatabase() {
  try {
    await mongoose.connect(`${process.env.URI}/${process.env.DB_NAME}`);
    // console.log("Database connected successfully");
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1); // fail code
  }
}

// Call the async function
// match and break down / command
async function parseCommand(context, org, comment) {
  const regex = /^(\/(new_user|del_user|del_repo|reset_repo|create_repos|create_custom_repos|markascompleted|bypass|accept|cache|updatereadme))(\s+(.+))?$/;
  const match = comment.match(regex);
  if (match) {
    const command = match[2];
    var argument = match[4];

    var response = "";
    var status = false;

    // detect command
    if (command) {
      const { owner, repo } = context.repo();
      switch (command) {
        case "create_repos":
          const users = argument.split(',').map(user => user.trim());
          response = await gameFunction.createRepos(context, org, users, db); 
          break;
        case "create_custom_repos":
          if (!argument) {
            response = "Usage: /create_custom_repos <users> <sequence_file>\nExample: /create_custom_repos user1,user2,user3 custom_sequence.json";
            break;
          }
          const parts = argument.split(' ');
          if (parts.length < 2) {
            response = "Usage: /create_custom_repos <users> <sequence_file>\nExample: /create_custom_repos user1,user2,user3 custom_sequence.json";
            break;
          }
          const sequenceFile = parts.pop(); // Get the last part as the sequence file
          const userList = parts.join(' ').split(',').map(user => user.trim());
          response = await gameFunction.createCustomRepos(context, org, userList, sequenceFile, db);
          break;
        case "new_user":
          // create user
          status = await db.createUser(argument);
          if (status) {
            response = responses.newUserResponse;
            var user_document = await db.downloadUserData(argument);
            await gameFunction.acceptQuest(context, user_document.user_data, "Q0");
            // update readme and data
            await gameFunction.updateReadme(
              owner,
              repo,
              context,
              user_document.user_data
            );
            await db.updateData(user_document);
          } else {
            response = "Failed to create new user, user already exists";
          }
          break;
        case "del_user":
          // wipe user from database
          await db.wipeUser(argument);
          response = "user wipe complete";
          break;
        case "del_repo":
          // delete repo
          response = await gameFunction.deleteRepo(context, owner, argument);
          break;
        case "reset_repo": // does not delete
          try {
            await gameFunction.resetReadme(org, argument, context);
            await gameFunction.closeIssues(context);
            response = "repo reset successful";
          } catch {
            response = "repo reset failed";
          }
          break;
        case "new_hint":
          // create hint
          status = await db.createHint(argument);
          if (status) {
            response = "Hint added";
          } else {
            response = "Failed to create hint";
          }
          break;
        case "markascompleted":
          // mark current task as completed and award all points
          response = await gameFunction.markAsCompleted(context, org, db);
          break;
        case "bypass":
          // bypass task validation and award full points (admin only)
          response = await bypassTask(context, org, argument);
          break;
        case "accept":
          // Accept/unlock a quest directly (e.g., /accept Q2)
          if (!argument) {
            response = "Usage: /accept <QuestId> (e.g., /accept Q2)";
            break;
          }
          try {
            await connectToDatabase();
            let dbUser = repo;
            if (repo.includes('-oss-doorway')) {
              dbUser = repo;
            } else if (repo.endsWith('-custom-oss-doorway')) {
              dbUser = repo.replace(/-custom-oss-doorway$/, '');
            }
            var user_document = await db.downloadUserData(dbUser);
            
            // Pass awaitCreation=true to ensure issues are created before README update
            response = await gameFunction.acceptQuest(context, user_document.user_data, argument.trim().toUpperCase(), true);
            await db.updateData(user_document);
            
            // Update README after quest acceptance (issues are now created)
            if (response) {
              try {
                await gameFunction.updateReadme(owner, repo, context, user_document.user_data, db);
                console.log(`✅ [ACCEPT] README updated after accepting quest ${argument.trim().toUpperCase()}`);
              } catch (readmeError) {
                console.error(`⚠️ [ACCEPT] README update failed after quest acceptance:`, readmeError.message);
                // Continue execution even if README update fails
              }
            }
            
            try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
            response = response ? `Accepted quest ${argument.trim().toUpperCase()}` : `Failed to accept quest ${argument.trim().toUpperCase()}`;
          } catch (e) {
            response = `Error: ${e.message}`;
          }
          break;
        case "cache":
          // Admin cache management
          // Usage:
          //   /cache clear-all
          //   /cache delete <groupId>
          //   /cache reload <groupId>  (deletes raw+processed)
          try {
            if (!argument) {
              response = "Usage: /cache <clear-all|delete <groupId>|reload <groupId>>";
              break;
            }
            const args = argument.trim().split(/\s+/);
            const subcmd = args[0].toLowerCase();
            if (subcmd === "clear-all") {
              ConfigService.clearCache();
              response = "✅ Cache cleared (all keys).";
            } else if (subcmd === "delete") {
              const groupId = args[1];
              if (!groupId) {
                response = "Usage: /cache delete <groupId>";
                break;
              }
              await ConfigService.deleteCacheKey(groupId);
              await ConfigService.deleteProcessedQuestConfigCache(groupId);
              response = `✅ Cache deleted for groupId: ${groupId}.`;
            } else if (subcmd === "reload") {
              const groupId = args[1];
              if (!groupId) {
                response = "Usage: /cache reload <groupId>";
                break;
              }
              await ConfigService.deleteCacheKey(groupId);
              await ConfigService.deleteProcessedQuestConfigCache(groupId);
              response = `✅ Cache deleted for groupId: ${groupId}. It will be reloaded on next access.`;
            } else {
              response = "Usage: /cache <clear-all|delete <groupId>|reload <groupId>>";
            }
          } catch (e) {
            response = `❌ Cache operation failed: ${e.message}`;
          }
          break;
        case "updatereadme":
          // Update README with current quest progress
          response = await updateReadmeCommand(context, org, db);
          break;
        default:
          response = responses.invalidCommand;
          break;
      }

      // feedback
      if (response !== "") {
        issueComment(context, response);
      }
    }
  }else{
    issueComment(context, responses.invalidCommand);
  }
}

async function issueComment(context, msg) {
  const issueComment = context.issue({ body: msg });
  try {
    await context.octokit.rest.issues.createComment(issueComment);
  } catch (error) {
    console.error("Error creating issue comment: ", error);
  }
}

async function isAdmin(context, org, username) {
  try {
    // Check if context.octokit.rest exists
    if (!context.octokit || !context.octokit.rest) {
      // console.log(`[isAdmin] context.octokit.rest not available, defaulting to non-admin for ${username}`);
      return false;
    }
    
    // Try to get organization owners
    try {
      const owner_list = await context.octokit.rest.orgs.listMembers({
        org,
        role: "owner",
      });
      
      if (owner_list && owner_list.data) {
        const owners = owner_list.data.map(user => user.login);
        return owners.includes(username);
      }
    } catch (orgError) {
      // console.log(`[isAdmin] Could not check org members for ${username}:`, orgError.message);
    }
    
    // If we can't get the owner list, fall back to checking if user is the org itself
    // This handles cases where the user might be the organization owner
    if (username === org) {
      // console.log(`[isAdmin] Username ${username} matches org ${org}, granting admin access`);
      return true;
    }
    
    // Fallback: check if user has admin access to the repository
    try {
      const { owner, repo } = context.repo();
      const repoAccess = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username
      });
      
      // Allow admin, write, or maintain permissions
      if (repoAccess && repoAccess.data && 
          ['admin', 'write', 'maintain'].includes(repoAccess.data.permission)) {
        // console.log(`[isAdmin] User ${username} has ${repoAccess.data.permission} permission on ${owner}/${repo}`);
        return true;
      }
    } catch (repoError) {
              // console.log(`[isAdmin] Could not check repo permissions for ${username}:`, repoError.message);
    }
    
    // console.log(`[isAdmin] User ${username} is not an admin in ${org}`);
    return false;
    
  } catch (error) {
    console.error(`[isAdmin] Unexpected error checking admin status for ${username} in ${org}:`, error.message);
    
    // If all checks fail, default to false (not admin) instead of throwing error
    // console.log(`[isAdmin] Defaulting to non-admin for ${username} in ${org}`);
    return false;
  }
}

// Function to check if user is an admin for the specific class
async function isClassAdmin(context, org, username) {
  try {
    // Get repository information to determine the class/group
    const { repo } = context.repo();
    
    // Connect to management database to check admin status
    // SECURITY: Never hardcode credentials. Always use environment variables.
    if (!process.env.OSS_DOORWAY_DB_URI) {
      console.error('[isClassAdmin] Error: OSS_DOORWAY_DB_URI environment variable is required');
      return false;
    }
    const managementDbUri = process.env.OSS_DOORWAY_DB_URI;
    const managementDbName = "management"; // Hardcoded to ensure correct database
    
    console.log(`[isClassAdmin] Connecting to management database: ${managementDbName}`);
    console.log(`[isClassAdmin] Checking admin status for user: ${username}`);
    console.log(`[isClassAdmin] Repository: ${repo}`);
    console.log(`[isClassAdmin] Organization: ${org}`);
    
    // Create a new connection to the OSS-Management database
    const managementConnection = mongoose.createConnection(managementDbUri, {
      dbName: managementDbName
    });
    
    // Wait for the connection to be established
    await new Promise((resolve, reject) => {
      managementConnection.once('connected', resolve);
      managementConnection.once('error', reject);
      // Add timeout
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
    
    try {
      // Query the groups collection to find the group that contains this repository
      // Repository names follow the pattern: username-classname
      // Handle multi-part usernames by trying different group name possibilities
      console.log(`[isClassAdmin] Extracting group name from repo: ${repo}`);
      const possibleGroupNames = generatePossibleGroupNames(repo);
      
      if (possibleGroupNames.length === 0) {
        console.log(`[isClassAdmin] Could not extract group name from repo: ${repo}`);
        return false;
      }
      
      console.log(`[isClassAdmin] Trying ${possibleGroupNames.length} possible group name(s): ${possibleGroupNames.join(', ')}`);
      
      // Query the groups collection for this group (case-insensitive)
      const groupsCollection = managementConnection.db.collection('groups');
      let group = null;
      
      // Try each possible group name
      let matchedGroupName = null;
      for (const groupName of possibleGroupNames) {
        console.log(`[isClassAdmin] Looking for group: ${groupName}`);
      
      // First try exact match
        group = await groupsCollection.findOne({ groupName: groupName });
      
      // If not found, try case-insensitive search
      if (!group) {
        group = await groupsCollection.findOne({ 
            groupName: { $regex: new RegExp(`^${escapeRegex(groupName)}$`, 'i') }
        });
      }
      
      // If still not found, try searching for variations with spaces instead of hyphens
      if (!group) {
        const spaceVariations = generateGroupNameVariations(groupName);
        
        for (const variation of spaceVariations) {
          group = await groupsCollection.findOne({ 
            groupName: { $regex: new RegExp(`^${escapeRegex(variation)}$`, 'i') }
          });
          if (group) {
            console.log(`[isClassAdmin] Found group with variation: "${variation}"`);
            break;
          }
          }
        }
        
        // If we found a group, store the matched name and stop trying other possibilities
        if (group) {
          matchedGroupName = groupName;
          console.log(`[isClassAdmin] Found group: ${group.groupName} (matched from: ${groupName})`);
          break;
        }
      }
      
      if (!group) {
        console.log(`[isClassAdmin] Group not found for repo: ${repo} (tried: ${possibleGroupNames.join(', ')})`);
        return false;
      }
      
      console.log(`[isClassAdmin] Group found: ${group.groupName}, checking admins...`);
      
      // Check if the user is an admin for this group
      if (group.admins && Array.isArray(group.admins)) {
        console.log(`[isClassAdmin] Found ${group.admins.length} admins in group`);
        
        const isAdminUser = group.admins.some(admin => 
          admin.githubUsername && admin.githubUsername.toLowerCase() === username.toLowerCase()
        );
        
        if (isAdminUser) {
          console.log(`[isClassAdmin] User ${username} is an admin for group ${group.groupName}`);
          return true;
        }
      }
      
      console.log(`[isClassAdmin] User ${username} is not an admin for group ${group.groupName}`);
      return false;
      
    } catch (dbError) {
      console.error(`[isClassAdmin] Database error checking admin status:`, dbError.message);
      return false;
    } finally {
      // Close the management database connection
      try {
        await managementConnection.close();
        console.log(`[isClassAdmin] Closed connection to OSS-Management database`);
      } catch (disconnectError) {
        console.error(`[isClassAdmin] Error closing management DB connection:`, disconnectError.message);
      }
    }
    
  } catch (error) {
    console.error(`[isClassAdmin] Unexpected error checking admin status for ${username}:`, error.message);
    
    // If check fails, default to false (not admin) for security
    return false;
  }
}

// Helper function to get all class admins for a repository
async function getClassAdmins(context) {
  try {
    const { repo } = context.repo();
    
    // SECURITY: Never hardcode credentials. Always use environment variables.
    if (!process.env.OSS_DOORWAY_DB_URI) {
      console.error('[isClassAdmin] Error: OSS_DOORWAY_DB_URI environment variable is required');
      return false;
    }
    const managementDbUri = process.env.OSS_DOORWAY_DB_URI;
    const managementDbName = "management";
    
    console.log(`[getClassAdmins] Connecting to management database for repo: ${repo}`);
    
    const managementConnection = mongoose.createConnection(managementDbUri, {
      dbName: managementDbName
    });
    
    await new Promise((resolve, reject) => {
      managementConnection.once('connected', resolve);
      managementConnection.once('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
    
    try {
      // Handle multi-part usernames by trying different group name possibilities
      const possibleGroupNames = generatePossibleGroupNames(repo);
      
      if (possibleGroupNames.length === 0) {
        console.log(`[getClassAdmins] Could not extract group name from repo: ${repo}`);
        return [];
      }
      
      console.log(`[getClassAdmins] Trying ${possibleGroupNames.length} possible group name(s): ${possibleGroupNames.join(', ')}`);
      
      const groupsCollection = managementConnection.db.collection('groups');
      let group = null;
      
      // Try each possible group name
      for (const groupName of possibleGroupNames) {
      // Try exact match first
        group = await groupsCollection.findOne({ groupName: groupName });
      
      // Try case-insensitive search
      if (!group) {
        group = await groupsCollection.findOne({ 
            groupName: { $regex: new RegExp(`^${escapeRegex(groupName)}$`, 'i') }
        });
      }
      
      // Try space variations
      if (!group) {
        const spaceVariations = generateGroupNameVariations(groupName);
        for (const variation of spaceVariations) {
          group = await groupsCollection.findOne({ 
            groupName: { $regex: new RegExp(`^${escapeRegex(variation)}$`, 'i') }
          });
          if (group) break;
          }
        }
        
        // If we found a group, stop trying other possibilities
        if (group) {
          console.log(`[getClassAdmins] Found group: ${group.groupName} (matched from: ${groupName})`);
          break;
        }
      }
      
      if (!group || !group.admins || !Array.isArray(group.admins)) {
        console.log(`[getClassAdmins] No group or admins found for repo: ${repo} (tried: ${possibleGroupNames.join(', ')})`);
        return [];
      }
      
      // Extract admin usernames
      const adminUsernames = group.admins
        .filter(admin => admin.githubUsername)
        .map(admin => admin.githubUsername.toLowerCase());
      
      console.log(`[getClassAdmins] Found ${adminUsernames.length} admins: ${adminUsernames.join(', ')}`);
      return adminUsernames;
      
    } catch (dbError) {
      console.error(`[getClassAdmins] Database error:`, dbError.message);
      return [];
    } finally {
      try {
        await managementConnection.close();
        console.log(`[getClassAdmins] Closed connection to management database`);
      } catch (disconnectError) {
        console.error(`[getClassAdmins] Error closing connection:`, disconnectError.message);
      }
    }
    
  } catch (error) {
    console.error(`[getClassAdmins] Unexpected error:`, error.message);
    return [];
  }
}

// Helper function to check if a comment should be ignored based on @mentions
async function shouldIgnoreMention(context, text, authorUsername) {
  try {
    // Extract all @mentions from the text
    // Match @ that is preceded by whitespace, start of string, or common punctuation
    // But not @ that is part of an email address
    const mentionPattern = /(^|[\s\(\[\{,;])@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionPattern.exec(text)) !== null) {
      mentions.push(match[2].toLowerCase()); // match[2] is the username part
    }
    
    if (mentions.length === 0) {
      // No mentions found, don't ignore
      return false;
    }
    
    console.log(`[shouldIgnoreMention] Found mentions: ${mentions.join(', ')}`);
    console.log(`[shouldIgnoreMention] Comment author: ${authorUsername}`);
    
    // Get all class admins for this repository
    const classAdmins = await getClassAdmins(context);
    
    // Check if any mention is either:
    // 1. A class admin, OR
    // 2. The comment author themselves
    const shouldIgnore = mentions.some(mentionedUser => {
      const isAdmin = classAdmins.includes(mentionedUser);
      const isSelfMention = mentionedUser === authorUsername.toLowerCase();
      
      if (isAdmin) {
        console.log(`[shouldIgnoreMention] Mention @${mentionedUser} is a class admin - IGNORE`);
        return true;
      }
      if (isSelfMention) {
        console.log(`[shouldIgnoreMention] Mention @${mentionedUser} is self-mention - IGNORE`);
        return true;
      }
      
      console.log(`[shouldIgnoreMention] Mention @${mentionedUser} is neither admin nor self - PROCESS`);
      return false;
    });
    
    return shouldIgnore;
    
  } catch (error) {
    console.error(`[shouldIgnoreMention] Error checking mentions:`, error.message);
    // On error, default to not ignoring (safer to process than miss legitimate commands)
    return false;
  }
}

// Helper function to extract group name from repository name
function extractGroupNameFromRepo(repoName) {
  // Repository names follow the pattern: username-classname
  // Examples: "student1-devil-red", "student2-superstar"
  const parts = repoName.split('-');
  
  if (parts.length < 2) {
    return null;
  }
  
  // Remove the username (first part) and join the rest as the group name
  const groupName = parts.slice(1).join('-');
  return groupName;
}

// Helper function to generate all possible group names from a repository name
// Handles multi-part usernames (e.g., "Asa-Henry-open-source-software-dev" -> tries "Henry-open-source-software-dev", "open-source-software-dev", etc.)
function generatePossibleGroupNames(repoName) {
  const parts = repoName.split('-');
  
  if (parts.length < 2) {
    return [];
  }
  
  const possibleNames = [];
  // Try removing 1, 2, 3, ... parts from the beginning
  // This handles cases where username is multi-part (e.g., "Asa-Henry")
  for (let i = 1; i < parts.length; i++) {
    possibleNames.push(parts.slice(i).join('-'));
  }
  
  return possibleNames;
}

// Helper function to generate variations of group names (hyphens vs spaces)
function generateGroupNameVariations(groupName) {
  const variations = [];
  
  // Original with hyphens
  variations.push(groupName);
  
  // Replace hyphens with spaces
  const withSpaces = groupName.replace(/-/g, ' ');
  if (withSpaces !== groupName) {
    variations.push(withSpaces);
  }
  
  // Replace spaces with hyphens (in case original had spaces)
  const withHyphens = groupName.replace(/\s+/g, '-');
  if (withHyphens !== groupName) {
    variations.push(withHyphens);
  }
  
  // Handle common patterns like "cs386-software-engineering" -> "CS 386 Software Engineering"
  if (groupName.includes('cs386')) {
    variations.push('CS 386 Software Engineering');
    variations.push('CS386 Software Engineering');
    variations.push('CS 386 SoftwareEngineering');
    // Add the exact format found in the database
    variations.push('CS386 - Software Engineering');
    variations.push('CS386 - SoftwareEngineering');
  }
  
  // Remove duplicates while preserving order
  return [...new Set(variations)];
}

// Helper function to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function bypassTask(context, org, argument) {
  try {
    const { owner, repo } = context.repo();
    const user = context.payload.comment.user.login;
    
    // Double-check admin status for security
    if (!await isClassAdmin(context, org, user)) {
      return "Access denied. Only class admins can use bypass commands.";
    }
    
    let questId, taskId;
    
    // If no argument provided, try to infer quest/task from the current issue title,
    // otherwise use the user's current quest/task from the database
    if (!argument || argument.trim() === '') {
      // Connect to database to get current quest and task
      await connectToDatabase();
      
      // Get repository user (same logic as main comment handler)
      let dbUser = repo;
      if (repo.includes('-oss-doorway')) {
        dbUser = repo;
      } else if (repo.endsWith('-custom-oss-doorway')) {
        dbUser = repo.replace(/-custom-oss-doorway$/, '');
      }
      
      // Download user data
      let user_document;
      try {
        user_document = await db.downloadUserData(dbUser);
      } catch (error) {
        try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
        return `Error: User ${dbUser} not found in database. Please create user first with /new_user ${dbUser}`;
      }
      
      // Try to parse quest/task from the issue title: "<group>-Qn Tm: description"
      const issueTitle = context.payload.issue?.title || '';
      const titleMatch = issueTitle.match(/^(.+?)-Q(\d+)\s+T(\d+):/i);
      if (titleMatch) {
        const questNum = titleMatch[2];
        const taskNum = titleMatch[3];
        questId = `Q${questNum}`;
        taskId = `T${taskNum}`;
        // Align user current to detected issue context to avoid mismatches (e.g., Q9 vs Q4)
        if (!user_document.user_data.current) user_document.user_data.current = {};
        user_document.user_data.current.quest = questId;
        user_document.user_data.current.task = taskId;
        // Persist alignment before proceeding
        await db.updateData(user_document);
        console.log(`[BYPASS] Detected quest/task from issue title: ${questId} ${taskId} → aligned current state`);
      } else {
        // Fallback to stored current quest/task
        if (!user_document.user_data.current || !user_document.user_data.current.quest || !user_document.user_data.current.task) {
          try {
            try {
          try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
          } catch (error) {
            console.log('[HELP] Database already disconnected or connection error:', error.message);
          }
          return "❌ No active quest or task found. Please start a quest first.";
        }
        questId = user_document.user_data.current.quest;
        taskId = user_document.user_data.current.task;
      }
      
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      console.log(`[BYPASS] Auto-detected current quest: ${questId}, task: ${taskId}`);
    } else {
      // Parse the argument - could be "Q1" (quest only) or "Q1 T1" (specific task)
      const questOnlyMatch = argument.trim().match(/^(q\d+)$/i);
      const questTaskMatch = argument.trim().match(/^(q\d+)\s+(t\d+)$/i);
      
      if (questOnlyMatch) {
        // Bypass entire quest
        questId = questOnlyMatch[1].toUpperCase(); // e.g., "q1" -> "Q1"
        taskId = null; // No specific task - bypass entire quest
        console.log(`[BYPASS] Quest-only bypass requested: ${questId}`);
      } else if (questTaskMatch) {
        // Bypass specific task
      questId = questTaskMatch[1].toUpperCase(); // e.g., "q1" -> "Q1"
      taskId = questTaskMatch[2].toUpperCase();  // e.g., "t1" -> "T1"
        console.log(`[BYPASS] Task-specific bypass requested: ${questId} ${taskId}`);
      } else {
        return "❌ Invalid bypass format. Use: `/bypass` (current task), `/bypass Q1` (entire quest), or `/bypass Q1 T1` (specific task)";
      }
    }
    
    // Connect to database
    await connectToDatabase();
    
    // Get repository user (same logic as main comment handler)
    let dbUser = repo;
    if (repo.includes('-oss-doorway')) {
      dbUser = repo;
    } else if (repo.endsWith('-custom-oss-doorway')) {
      dbUser = repo.replace(/-custom-oss-doorway$/, '');
    }
    
    // Download user data
    let user_document;
    try {
      user_document = await db.downloadUserData(dbUser);
    } catch (error) {
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      return `Error: User ${dbUser} not found in database. Please create user first with /new_user ${dbUser}`;
    }
    
    // Handle quest-only bypass
    if (taskId === null) {
      // Validate that the specified quest matches the current active one
      if (!user_document.user_data.current || 
          user_document.user_data.current.quest !== questId) {
        try {
          mongoose.disconnect();
        } catch (error) {
          console.log('[BOT] Database already disconnected or connection error:', error.message);
        }
        return `❌ Cannot bypass quest ${questId}. You are currently on quest ${user_document.user_data.current?.quest || 'none'}. Only bypass the current active quest.`;
      }
      
      // Set current quest for bypassAllTasks
      if (!user_document.user_data.current) {
        user_document.user_data.current = {};
      }
      user_document.user_data.current.quest = questId;
      
      // Bypass all tasks in the quest
      const response = await gameFunction.bypassAllTasks(user_document.user_data, context, db);
      
      // Update user data
      await db.updateData(user_document);
      mongoose.disconnect();
      
      return response;
    }
    
    // Handle task-specific bypass (existing logic)
    console.log(`[BYPASS] Admin ${user} initiated bypass for repo: ${repo}, quest: ${questId}, task: ${taskId}`);
    
    // Validate that the specified quest-task matches the current active one
    if (!user_document.user_data.current || 
        user_document.user_data.current.quest !== questId || 
        user_document.user_data.current.task !== taskId) {
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      return `❌ Cannot bypass ${questId} ${taskId}. You are currently on quest ${user_document.user_data.current?.quest || 'none'} task ${user_document.user_data.current?.task || 'none'}. Only bypass the current active quest-task.`;
    }
    
    // Bypass the specific quest-task (combine quest and task without space for gamification module)
    const combinedTaskId = questId + taskId; // e.g., "Q1" + "T1" = "Q1T1"
    const response = await gameFunction.bypassSpecificTask(user_document.user_data, combinedTaskId, context, db);
    
    // Update user data
    await db.updateData(user_document);
    mongoose.disconnect();
    
    return response;
    
  } catch (error) {
    console.error(`[BYPASS] Error in bypassTask:`, error);
    try {
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
    } catch (disconnectError) {
      // Ignore disconnect errors
    }
    return `Error during bypass operation: ${error.message}`;
  }
}

async function updateReadmeCommand(context, org, db) {
  try {
    const { owner, repo } = context.repo();
    const username = context.payload.comment.user.login;
    
    console.log(`📝 [UPDATE-README] Processing /updatereadme command for ${owner}/${repo} by ${username}`);
    
    // Connect to database
    await connectToDatabase();
    
    // Get repository user (same logic as main comment handler)
    let dbUser = repo;
    if (repo.includes('-oss-doorway')) {
      dbUser = repo;
    } else if (repo.endsWith('-custom-oss-doorway')) {
      dbUser = repo.replace(/-custom-oss-doorway$/, '');
    }
    
    console.log(`📝 [UPDATE-README] Database user key: ${dbUser}`);
    
    // Download user data
    let user_document;
    try {
      user_document = await db.downloadUserData(dbUser);
    } catch (error) {
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      return `❌ Error: User ${dbUser} not found in database. Please create user first with /new_user ${dbUser}`;
    }
    
    // Update README using the same logic as task validation
    try {
      await gameFunction.updateReadme(owner, repo, context, user_document.user_data, db);
      console.log(`✅ [UPDATE-README] README updated successfully for ${owner}/${repo}`);
      
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      return `✅ **README Updated Successfully!**\n\n📄 The README has been updated with your current quest progress.\n🕒 Update completed at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })} MST`;
      
    } catch (readmeError) {
      console.error(`❌ [UPDATE-README] README update failed:`, readmeError.message);
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
      return `❌ Error updating README: ${readmeError.message}`;
    }
    
  } catch (error) {
    console.error('❌ [UPDATE-README] Error in updateReadmeCommand:', error);
    try {
      try {
        mongoose.disconnect();
      } catch (error) {
        console.log('[BOT] Database already disconnected or connection error:', error.message);
      }
    } catch (disconnectError) {
      // Ignore disconnect errors
    }
    return `❌ Error during README update: ${error.message}`;
  }
}

async function checkOSSRepo() {
  if (!process.env.OSS_REPO) {
      // console.log('OSS_REPO is missing in the .env file.');
      // console.log('Expected input: <owner/repo>, owner is either a GitHub username or organization and repo is the OSS repo.')
      // console.warn('The bot cannot respond in this repo, it is read only. The user or organization should own the OSS repo.')
      // console.log('Please enter the repository:');
      
      const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
      });

      return new Promise((resolve) => {
          rl.question('OSS_REPO: ', (answer) => {
              rl.close();
              
              fs.appendFileSync('.env', `OSS_REPO="${answer}"\n`);
              // console.log('OSS_REPO has been added to .env file.\n');
              resolve(answer);
          });
      });
  } else {
      // console.log('✅ OSS_REPO found:', process.env.OSS_REPO, '\n');
      return process.env.OSS_REPO;
  }
}
