import fs from "fs";
import { taskMapping } from "./taskMapping.js";
import LLM from "./llm.js"
import { getQuestConfig, getQuestSequence as getQuestSequenceFromConfig, getGroupQuestConfig } from "./config/questConfigGenerator.js";
import { ConfigService } from "./services/configService.js";
import { getCompleteResponseObject } from "./config/responseGenerator.js";
import { getHintBySequence, getHintCount, hintExists } from "./config/hintGenerator.js";
import { 
  handleMCQ, 
  handleTrueFalse, 
  handleCustom, 
  handleIssueCount, 
  handlePRCount, 
  handleTopContributor, 
  handleIssueTitle, 
  handleOpenIssues, 
  handleQuest, 
  handleAssigned, 
  handleIssueNo, 
  handleCustomAPICall, 
  handleLLMTextValidation, 
  handleImageValidation,
  handleComment,
  handleCollectInfo,
  handleForkUrlValidation,
  handleFileExistsValidation,
  handleFileContentValidation,
  handlePRUrlValidation,
  handlePushValidation,
  handleIterativeCodeReview,
  handleBotCodeReview,
  handleGitHubActionsValidation,
  handleRepositoryValidation
} from "./handlers/genericHandlers.js";

// Files from context of file accessing exported functions (from viewpoint of index.js) when using I/O functions
const questSequenceFilePath = "./src/config/quest-sequence.json";

const svgTemplatePath = "./src/templates/template.svg";
const classSvgTemplatePath = "./src/templates/class-template.svg";
const defaultReadmePath = "./src/templates/main.md";
const progressReadmePath = "./src/templates/progress.md";

// Get quest response data from the generator instead of reading response.json
const questResponse = getCompleteResponseObject();

// Function to convert questSequence format to legacy flat format
async function convertQuestSequenceToLegacy(questConfig) {
  try {
    console.log(`🔧 [CONVERT] Starting questSequence to legacy conversion...`);
    const legacyConfig = { map_repo_link: questConfig.map_repo_link };

    questConfig.questSequence.forEach((quest) => {
      const questId = quest.questId;
      console.log(`🔍 [CONVERT] Processing quest ${questId}: quest.title="${quest.title}", quest.metadata?.title="${quest.metadata?.title}"`);
      const processedTasks = {};

      Object.entries(quest.tasks || {}).forEach(([taskId, taskData]) => {
        const processedTask = { ...taskData };

        // If quiz, bake questions into accept
        if (processedTask.type === 'quiz' && Array.isArray(processedTask.questions) && processedTask.questions.length > 0) {
          console.log(`🧠 [CONVERT] Processing quiz task ${questId}.${taskId} with ${processedTask.questions.length} questions`);
          
          let quizContent = '';
          if (processedTask.accept) {
            quizContent = processedTask.accept + '\n\n';
          } else {
            // Basic intro if none provided
            quizContent = `🧠 Quest Quiz\nAnswer the following questions to test your knowledge.\n\n`;
          }

          processedTask.questions.forEach((q, idx) => {
            if (q?.question) {
              quizContent += `Question ${idx + 1}:\n${q.question}\n\n`;
              if (q.optionA) quizContent += `A) ${q.optionA}\n`;
              if (q.optionB) quizContent += `B) ${q.optionB}\n`;
              if (q.optionC) quizContent += `C) ${q.optionC}\n`;
              if (q.optionD) quizContent += `D) ${q.optionD}\n`;
              quizContent += `\n`;
            }
          });

          quizContent += `Important: please provide answers in the format [x,x,x,x,x]\nNote that there is only one attempt allowed!\n\nClick here to start`;
          processedTask.accept = quizContent;
          
          // CRITICAL: Ensure questions array structure is preserved for validation
          console.log(`🧠 [CONVERT] Converted quiz task ${questId}.${taskId} with ${processedTask.questions.length} questions`);
          console.log(`🧠 [CONVERT] Questions structure preserved for validation`);
          console.log(`🧠 [CONVERT] Updated accept message preview: ${processedTask.accept.substring(0, 300)}...`);
        }

        processedTasks[taskId] = processedTask;
      });

      // Attach metadata if present, and preserve quest title for title-based mapping
      if (quest.metadata) {
        // Preserve quest.title in metadata for title-based handler mapping
        const questTitleToStore = quest.title || quest.metadata.title;
        console.log(`🔍 [CONVERT] Quest ${questId}: Storing questTitle="${questTitleToStore}" in metadata`);
        const enhancedMetadata = {
          ...quest.metadata,
          questTitle: questTitleToStore // Store quest title for mapping
        };
        legacyConfig[questId] = { ...processedTasks, metadata: enhancedMetadata };
      } else {
        // Even without metadata, preserve quest title if it exists
        const questTitleToStore = quest.title;
        console.log(`🔍 [CONVERT] Quest ${questId}: No metadata, storing questTitle="${questTitleToStore}" in new metadata`);
        const metadata = questTitleToStore ? { questTitle: questTitleToStore } : {};
        legacyConfig[questId] = { ...processedTasks, metadata };
      }
    });

    console.log(`✅ [CONVERT] Conversion complete. Legacy config keys:`, Object.keys(legacyConfig));
    return legacyConfig;
  } catch (error) {
    console.error(`❌ [CONVERT] Error during conversion:`, error);
    throw error;
  }
}

// Function to get quest config based on user data (supports custom groups)

// Helper function to determine navigation text based on current quest/task position
// NOTE: This function is only called when a task is completed successfully
// For failed attempts, no navigation is shown - user stays on current task
function getNavigationText(quest, task, questConfig, owner, repo, user_data) {
  try {
    // Safety check for user_data
    if (!user_data || !user_data.accepted) {
      return `Go to [all issues](https://github.com/${owner}/${repo}/issues)`;
    }
    
    // Get all quests in order
    const allQuests = Object.keys(questConfig).filter(q => q !== 'metadata');
    
    // Find current quest index
    const currentQuestIndex = allQuests.indexOf(quest);
    
    if (currentQuestIndex === -1) {
      // Fallback if quest not found
      return `Go to [all issues](https://github.com/${owner}/${repo}/issues)`;
    }
    
    // Get current quest tasks
    const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
    
    // Find current task index
    const currentTaskIndex = currentQuestTasks.indexOf(task);
    
    if (currentTaskIndex === -1) {
      // Fallback if task not found
      return `Go to [all issues](https://github.com/${owner}/${repo}/issues)`;
    }
    
    // Check if there's a next task in current quest
    if (currentTaskIndex < currentQuestTasks.length - 1) {
      const nextTask = currentQuestTasks[currentTaskIndex + 1];
      
      // Check if we have the issue number for the next task
      if (user_data.accepted && user_data.accepted[quest] && user_data.accepted[quest][nextTask] && user_data.accepted[quest][nextTask].issueNum) {
        const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
        return `Go to [next task](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
      } else {
        // Fallback if issue number not available
        return `Go to [next task](https://github.com/${owner}/${repo}/issues)`;
      }
    }
    
    // Check if there's a next quest
    if (currentQuestIndex < allQuests.length - 1) {
      const nextQuest = allQuests[currentQuestIndex + 1];
      const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).find(t => t !== 'metadata');
      if (nextQuestFirstTask) {
        // Check if we have the issue number for the first task of the next quest
        if (user_data.accepted && user_data.accepted[nextQuest] && user_data.accepted[nextQuest][nextQuestFirstTask] && user_data.accepted[nextQuest][nextQuestFirstTask].issueNum) {
          const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
          return `Go to [next quest](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
        } else {
          // Fallback if issue number not available
          return `Go to [next quest](https://github.com/${owner}/${repo}/issues)`;
        }
      }
    }
    
    // At the very end - go to issues page
    return `Go to [all issues](https://github.com/${owner}/${repo}/issues)`;
    
  } catch (error) {
    console.error('Error generating navigation text:', error);
    // Fallback to issues page
    return `Go to [all issues](https://github.com/${owner}/${repo}/issues)`;
  }
}
async function getQuestConfigForUser(user_data) {
  const startTime = Date.now();
  console.log(`🔍 [BOT-QUEST-LOAD] User: ${user_data?.github || user_data?.username || 'unknown'}`);
  console.log(`🔍 [BOT-QUEST-LOAD] customGroupId: ${user_data?.customGroupId || 'none'}`);
  
  // PRIORITY 1: Check high-level cache first (processed quest config)
  const cacheKey = `processed-quest-config-${user_data?.customGroupId || 'default'}`;
  if (ConfigService.has(cacheKey)) {
    const cachedConfig = ConfigService.get(cacheKey);
    const duration = Date.now() - startTime;
    console.log(`⚡ [BOT-QUEST-LOAD] Processed quest config served from cache in ${duration}ms`);
    return cachedConfig;
  }
  
  console.log(`🐌 [BOT-QUEST-LOAD] Cache miss, processing quest config...`);
  
  let questConfig = null;
  
  if (user_data && user_data.customGroupId) {
    try {
      console.log(`🔍 [BOT-QUEST-LOAD] Attempting to load group config for: ${user_data.customGroupId}`);
      
      // PRIORITY 2: Load from database/file (via ConfigService)
      const result = await getGroupQuestConfig(user_data.customGroupId);
      if (result) {
        console.log(`✅ [BOT-QUEST-LOAD] Successfully loaded group config with ${Object.keys(result).length} keys:`, Object.keys(result).slice(0, 5));
        console.log(`🔍 [BOT-QUEST-LOAD] All loaded keys:`, Object.keys(result));
        questConfig = result;
        
        // IMMEDIATELY convert questSequence format to legacy format if needed
        if (Array.isArray(questConfig?.questSequence)) {
          console.log(`🔧 [BOT-QUEST-LOAD] Converting questSequence format to legacy format...`);
          questConfig = await convertQuestSequenceToLegacy(questConfig);
          console.log(`✅ [BOT-QUEST-LOAD] Conversion complete. Keys:`, Object.keys(questConfig));
        } else {
          // Config is already in legacy format - enrich with questTitle if missing
          // This handles old database entries that don't have questTitle preserved
          console.log(`🔧 [BOT-QUEST-LOAD] Config is in legacy format, enriching with questTitle if missing...`);
          questConfig = enrichLegacyConfigWithQuestTitles(questConfig);
        }
      } else {
        console.log(`❌ [BOT-QUEST-LOAD] Group config not found for ${user_data.customGroupId}, falling back to default config`);
      }
    } catch (error) {
      console.log(`❌ [BOT-QUEST-LOAD] Error loading group config for ${user_data.customGroupId}: ${error.message}`);
      console.log(`🔍 [BOT-QUEST-LOAD] Falling back to default config`);
    }
  } else {
    console.log(`🔍 [BOT-QUEST-LOAD] No custom group ID, using default config`);
  }
  
  // PRIORITY 3: Fallback to default config if no group config loaded
  if (!questConfig) {
    console.log(`🔍 [BOT-QUEST-LOAD] Loading default quest config...`);
    questConfig = getQuestConfig();
    if (!questConfig) {
      console.error('[BOT-QUEST-LOAD] CRITICAL: Default quest config not found!');
      throw new Error('Default quest configuration not available');
    }
    
    // IMMEDIATELY convert questSequence format to legacy format if needed
    if (Array.isArray(questConfig?.questSequence)) {
      console.log(`🔧 [BOT-QUEST-LOAD] Converting default questSequence format to legacy format...`);
      questConfig = await convertQuestSequenceToLegacy(questConfig);
      console.log(`✅ [BOT-QUEST-LOAD] Default config conversion complete. Keys:`, Object.keys(questConfig));
    }
    
    console.log(`✅ [BOT-QUEST-LOAD] Loaded default config with ${Object.keys(questConfig).length} keys`);
  }

  // For draft/test repos: normalize any temporary quest IDs to Q1, Q2, ...
  try {
    const isTestGroup = typeof user_data?.customGroupId === 'string' && user_data.customGroupId.toLowerCase().includes('test');
    if (isTestGroup) {
      const beforeKeys = Object.keys(questConfig || {});
      const normalized = normalizeQuestIdsForDrafts(questConfig);
      const afterKeys = Object.keys(normalized || {});
      if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
        console.log(`[BOT-QUEST-LOAD] ✨ Normalized quest IDs for draft/test group. Before: ${beforeKeys.join(', ')} | After: ${afterKeys.join(', ')}`);
      } else {
        console.log(`[BOT-QUEST-LOAD] Quest IDs already normalized for draft/test group.`);
      }
      questConfig = normalized;
    }
  } catch (normErr) {
    console.warn(`[BOT-QUEST-LOAD] Failed to normalize quest IDs for draft/test group: ${normErr.message}`);
  }

  // Cache the processed quest config for future requests (1 hour TTL)
  console.log(`💾 [BOT-QUEST-LOAD] Caching processed quest config for future requests (1 hour TTL)`);
  console.log(`🔍 [BOT-QUEST-LOAD] Final quest config keys before caching:`, Object.keys(questConfig));
  ConfigService.set(cacheKey, questConfig, 3600000); // 1 hour
  
  const duration = Date.now() - startTime;
  console.log(`✅ [BOT-QUEST-LOAD] Quest config processing complete in ${duration}ms`);
  return questConfig;
}

// Normalize nonstandard quest IDs (e.g., temp_1234) to Q1, Q2, ... for draft/test groups
function normalizeQuestIdsForDrafts(questConfig) {
  if (!questConfig || typeof questConfig !== 'object') return questConfig;

  // If it already has standard Qn keys, leave as-is
  const hasStandardQ = Object.keys(questConfig).some((k) => /^Q\d+$/i.test(k));
  if (hasStandardQ) return questConfig;

  const isQuestBlock = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.metadata && typeof obj.metadata === 'object') return true;
    // Heuristic: contains task keys like T1, T2
    return Object.keys(obj).some((t) => /^T\d+$/i.test(t));
  };

  const newConfig = {};
  let qIndex = 1;

  // Preserve non-quest top-level keys (e.g., map_repo_link)
  for (const [key, value] of Object.entries(questConfig)) {
    if (!isQuestBlock(value)) {
      newConfig[key] = value;
    }
  }

  // Remap quest-like blocks to Q1, Q2, ...
  for (const [key, value] of Object.entries(questConfig)) {
    if (isQuestBlock(value)) {
      const newKey = `Q${qIndex++}`;
      newConfig[newKey] = value;
    }
  }

  return newConfig;
}

// Enrich legacy config with questTitle in metadata if missing
// This helps with old database entries that don't have questTitle preserved
function enrichLegacyConfigWithQuestTitles(questConfig) {
  if (!questConfig || typeof questConfig !== 'object') return questConfig;
  
  // Map of known quest content patterns to quest titles
  // This is a fallback for legacy configs that don't have questTitle
  const questTitleMapping = {
    "Understanding OSS Projects and GitHub Basics": "Understanding OSS Projects and GitHub Basics",
    "Forking and Contributing to Repositories": "Forking and Contributing to Repositories",
    "Creating Pull Requests and Code Reviews": "Creating Pull Requests and Code Reviews"
  };
  
  // Try to infer quest title from metadata.title or quest structure
  for (const [questId, questData] of Object.entries(questConfig)) {
    if (questId === "map_repo_link" || typeof questData !== "object") continue;
    
    // If metadata exists but questTitle is missing, try to add it
    if (questData.metadata && !questData.metadata.questTitle) {
      // Check if metadata.title matches a known quest title
      const metadataTitle = questData.metadata.title;
      if (metadataTitle && questTitleMapping[metadataTitle]) {
        questData.metadata.questTitle = questTitleMapping[metadataTitle];
        console.log(`🔧 [enrichLegacyConfig] Added questTitle="${questData.metadata.questTitle}" to ${questId} from metadata.title`);
      } else {
        // For legacy quests, metadata.title might be different - try to match by content
        // Check if this quest has tasks that match known legacy quest patterns
        // Q1 pattern: Has T1 task about issues
        if (questData.T1 && questData.T1.accept && questData.T1.accept.includes("issue tracker")) {
          questData.metadata.questTitle = "Understanding OSS Projects and GitHub Basics";
          console.log(`🔧 [enrichLegacyConfig] Inferred questTitle="Understanding OSS Projects and GitHub Basics" for ${questId} from task content`);
        }
        // Q2 pattern: Has T1 task about assigned user
        else if (questData.T1 && questData.T1.accept && questData.T1.accept.includes("assigned user")) {
          questData.metadata.questTitle = "Forking and Contributing to Repositories";
          console.log(`🔧 [enrichLegacyConfig] Inferred questTitle="Forking and Contributing to Repositories" for ${questId} from task content`);
        }
        // Q3 pattern: Has T1 task about solving issue/uploading file
        else if (questData.T1 && questData.T1.accept && (questData.T1.accept.includes("upload") || questData.T1.accept.includes("solve the issue"))) {
          questData.metadata.questTitle = "Creating Pull Requests and Code Reviews";
          console.log(`🔧 [enrichLegacyConfig] Inferred questTitle="Creating Pull Requests and Code Reviews" for ${questId} from task content`);
        }
      }
    }
  }
  
  return questConfig;
}

// Function to get quest sequence based on user data (supports custom groups)
function getQuestSequenceForUser(user_data) {
  if (user_data.customGroupId) {
    try {
      return getQuestSequenceFromConfig(user_data.customGroupId);
  } catch (error) {
      console.warn(`Failed to load group sequence for ${user_data.customGroupId}, falling back to default`);
    }
  }
  return getQuestSequenceFromConfig();
}

const ossRepo = process.env.OSS_REPO;
// Fix: Get quest config properly instead of using undefined quests variable
const defaultQuestConfig = getQuestConfig();
const mapRepoLink = defaultQuestConfig.map_repo_link;
const llmInstance = new LLM();

//////////////////////////////////
/* ----- QUEST MANAGEMENT ----- */
//////////////////////////////////

// Will also start the first task associated with quest
// Helper function to check if enhanced quest system is enabled
function isEnhancedQuestSystemEnabled() {
  return true;
}

// Helper function to get task buffer size
function getTaskBufferSize() {
  return parseInt(process.env.TASK_BUFFER_SIZE) || 1;
}

// Helper function to check if quest is complete
function isQuestComplete(user_data, quest) {
  if (!user_data.accepted || !user_data.accepted[quest]) {
    return false;
  }
  
  return Object.values(user_data.accepted[quest])
    .filter(task => typeof task === 'object' && task.hasOwnProperty('completed'))
    .every(task => task.completed);
}

// Helper function to get ordered task list
function getOrderedTasks(questConfig) {
  return Object.keys(questConfig)
    .filter((key) => /^T\d+$/i.test(key))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// Helper function to create multiple task environments with delays
async function createTaskEnvironmentsInBatch(user_data, quest, tasks, context, startIndex = 0) {
  const bufferSize = getTaskBufferSize();
  const tasksToCreate = tasks.slice(startIndex, startIndex + bufferSize);
  
  console.log(`[acceptQuest] 🚀 Queueing environments for ${quest} tasks: ${tasksToCreate.join(', ')}...`);
  
  // Import priority queue
  const { priorityQueue } = await import('./services/priorityQueueService.js');
  
  for (let i = 0; i < tasksToCreate.length; i++) {
    const task = tasksToCreate[i];
    priorityQueue.enqueue('LOW', async () => {
      try {
        await createQuestEnvironment(user_data, quest, task, context);
        console.log(`[acceptQuest] ✅ Environment created for ${quest}.${task}`);
      } catch (error) {
        console.error(`[acceptQuest] ❌ Failed to create environment for ${quest}.${task}:`, error.message);
        throw error;
      }
    }, {
      type: 'batch_issue_creation',
      quest: quest,
      task: task,
      user: user_data?.github || 'unknown',
      maxRetries: 3
    });
  }
  
  console.log(`[acceptQuest] ✅ Queued ${tasksToCreate.length} environments for ${quest}`);
}

// Helper function to maintain sliding window of available tasks
async function maintainTaskBuffer(user_data, quest, context, questConfig, awaitCreation = false) {
  try {
    const bufferSize = getTaskBufferSize();
    const orderedTasks = getOrderedTasks(questConfig);
    
    // Reconcile: ensure user_data has issue numbers for already-existing issues to avoid backfilling
    await reconcileIssuesForQuest(user_data, quest, context, orderedTasks);
    
    // Count tasks with environments that are still active (exclude completed)
    let tasksWithEnvironments = 0;
    const tasksWithEnvList = [];
    
    for (const task of orderedTasks) {
      const taskState = user_data.accepted[quest][task];
      if (taskState && taskState.issueNum > 0 && taskState.completed !== true) {
        tasksWithEnvironments++;
        tasksWithEnvList.push(task);
      }
    }
    
    console.log(`[maintainTaskBuffer] 🔄 ${quest}: ${tasksWithEnvironments}/${orderedTasks.length} tasks have environments`);
    
    // If we have fewer than buffer size tasks with environments, create more
    if (tasksWithEnvironments < bufferSize && tasksWithEnvironments < orderedTasks.length) {
      const tasksNeeded = Math.min(
        bufferSize - tasksWithEnvironments,
        orderedTasks.length - tasksWithEnvironments
      );

      // Backfill gaps first: pick earliest tasks without environments and not completed
      const tasksToCreate = [];
      for (let i = 0; i < orderedTasks.length; i++) {
        if (tasksToCreate.length >= tasksNeeded) break;
        const taskKey = orderedTasks[i];
        const state = user_data.accepted?.[quest]?.[taskKey];
        const hasIssue = Boolean(state && state.issueNum > 0);
        const isCompletedInCompleted = Boolean(
          user_data.completed &&
          user_data.completed[quest] &&
          user_data.completed[quest][taskKey] &&
          user_data.completed[quest][taskKey].completed
        );
        if (!hasIssue && !isCompletedInCompleted) {
          tasksToCreate.push(taskKey);
        }
      }
      
      if (tasksToCreate.length > 0) {
        console.log(`[maintainTaskBuffer] 🌟 ${awaitCreation ? 'Creating' : 'Queueing'} environments for next ${tasksToCreate.length} tasks: ${tasksToCreate.join(', ')}`);
        
        if (awaitCreation) {
          // Create issues immediately and await them (used during task completion for immediate README update)
          for (let i = 0; i < tasksToCreate.length; i++) {
            const task = tasksToCreate[i];
            try {
              await createQuestEnvironment(user_data, quest, task, context);
              console.log(`[maintainTaskBuffer] ✅ Environment created for ${quest}.${task}`);
              // Small delay between creations to avoid rate limits
              if (i < tasksToCreate.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              console.error(`[maintainTaskBuffer] ❌ Failed to create environment for ${quest}.${task}:`, error.message);
            }
          }
        } else {
          // Queue issue creation as LOW priority (used for background buffer maintenance)
          const { priorityQueue } = await import('./services/priorityQueueService.js');
          
          for (let i = 0; i < tasksToCreate.length; i++) {
            const task = tasksToCreate[i];
            
            priorityQueue.enqueue('LOW', async () => {
              try {
                await createQuestEnvironment(user_data, quest, task, context);
                console.log(`[maintainTaskBuffer] ✅ Environment created for ${quest}.${task}`);
              } catch (error) {
                console.error(`[maintainTaskBuffer] ❌ Failed to create environment for ${quest}.${task}:`, error.message);
                throw error;
              }
            }, {
              type: 'bulk_issue_creation',
              quest: quest,
              task: task,
              user: user_data?.github || 'unknown',
              maxRetries: 3
            });
          }
        }
      }
    } else {
      console.log(`[maintainTaskBuffer] ✅ Task buffer is adequate for ${quest}`);
    }
  } catch (error) {
    console.error(`[maintainTaskBuffer] Error maintaining task buffer for ${quest}:`, error.message);
  }
}

// Reconcile existing GitHub issues to user_data to prevent duplicate creation/backfilling
async function reconcileIssuesForQuest(user_data, quest, context, orderedTasks) {
  try {
    const { owner, repo } = context.repo();
    const listResponse = await context.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'all',
      per_page: 100
    });

    const issues = listResponse.data || [];
    const titleToIssue = new Map();
    const archivedIssueNumbers = new Set();

    for (const issue of issues) {
      // Skip archived issues (any label containing 'archived')
      const hasArchivedLabel = Array.isArray(issue.labels) && issue.labels.some(l => {
        const name = typeof l === 'string' ? l : l?.name;
        return name && name.toLowerCase().includes('archived');
      });
      if (hasArchivedLabel) {
        // console.log(`[reconcileIssuesForQuest] ⏭️ Skipping archived issue #${issue.number}: ${issue.title}`);
        archivedIssueNumbers.add(issue.number);
        continue;
      }
      const title = issue.title || '';
      // Match patterns like "Q1 T3:", "Q1.T3", "<Class>-Q1 T3:" etc.
      const match = title.match(/(?:^|\b)(?:[A-Za-z0-9_-]+-)?(Q\d+)\s*[\.|\s]?\s*(T\d+)\b/i);
      if (match) {
        const q = match[1].toUpperCase();
        const t = match[2].toUpperCase();
        titleToIssue.set(`${q}.${t}`, issue);
      }
    }

    // Ensure quest container exists
    user_data.accepted = user_data.accepted || {};
    user_data.accepted[quest] = user_data.accepted[quest] || {};

    // Clear issueNum from user_data if it points to an archived issue
    for (const task of orderedTasks) {
      const taskState = user_data.accepted[quest][task];
      if (taskState && taskState.issueNum && archivedIssueNumbers.has(taskState.issueNum)) {
        console.log(`[reconcileIssuesForQuest] 🗑️ Clearing archived issue #${taskState.issueNum} from ${quest}.${task}`);
        taskState.issueNum = 0;
        taskState.completed = false;
      }
    }

    for (const task of orderedTasks) {
      const key = `${quest}.${task}`.toUpperCase();
      const matchedIssue = titleToIssue.get(key);
      if (matchedIssue) {
        // Ensure task state exists
        user_data.accepted[quest][task] = user_data.accepted[quest][task] || {};
        const taskState = user_data.accepted[quest][task];
        if (!taskState.issueNum || taskState.issueNum === 0) {
          taskState.issueNum = matchedIssue.number;
          console.log(`[reconcileIssuesForQuest] 🔁 Synced issue #${matchedIssue.number} for ${quest}.${task} (state: ${matchedIssue.state})`);
        }
        // Optionally reflect completion if issue is closed
        if (matchedIssue.state === 'closed' && taskState.completed !== true) {
          taskState.completed = true;
        }
      }
    }
  } catch (error) {
    console.warn(`[reconcileIssuesForQuest] ⚠️ Failed to reconcile issues for ${quest}: ${error.message}`);
  }
}

// Helper function to create task on-demand for backward compatibility
async function createTaskOnDemand(user_data, questId, taskId, issueNumber, context) {
  try {
    console.log(`[createTaskOnDemand] 🌟 Attempting to create ${questId}.${taskId} on-demand`);
    
    // Get quest config to verify the task exists
    const quests = await getQuestConfigForUser(user_data);
    
    if (!quests[questId]) {
      console.log(`[createTaskOnDemand] Quest ${questId} not found in config`);
      return false;
    }
    
    if (!quests[questId][taskId]) {
      console.log(`[createTaskOnDemand] Task ${taskId} not found in quest ${questId}`);
      return false;
    }
    
    // Initialize accepted quests if not exists
    if (!user_data.accepted) {
      user_data.accepted = {};
    }
    
    // Initialize quest if not exists
    if (!user_data.accepted[questId]) {
      console.log(`[createTaskOnDemand] 🌟 Creating quest ${questId} on-demand`);
      user_data.accepted[questId] = {};
      
      // Create all tasks in the quest
      for (const task in quests[questId]) {
        if (task !== "metadata") {
          user_data.accepted[questId][task] = {
            completed: false,
            attempts: 0,
            hints: 0,
            timeStart: 0,
            timeEnd: 0.0,
            issueNum: 0,
          };
        }
      }
    }
    
    // Check if task already exists
    if (user_data.accepted[questId][taskId]) {
      // Update the issue number if it doesn't match
      if (user_data.accepted[questId][taskId].issueNum !== issueNumber) {
        console.log(`[createTaskOnDemand] 🌟 Updating issue number for ${questId}.${taskId}: ${user_data.accepted[questId][taskId].issueNum} -> ${issueNumber}`);
        user_data.accepted[questId][taskId].issueNum = issueNumber;
      }
      return true;
    }
    
    // Create the specific task if it doesn't exist (shouldn't happen with above logic, but safety check)
    user_data.accepted[questId][taskId] = {
      completed: false,
      attempts: 0,
      hints: 0,
      timeStart: 0,
      timeEnd: 0.0,
      issueNum: issueNumber,
    };
    
    console.log(`[createTaskOnDemand] 🌟 Successfully created ${questId}.${taskId} on-demand with issue #${issueNumber}`);
    return true;
    
  } catch (error) {
    console.error(`[createTaskOnDemand] Error creating task on-demand:`, error);
    return false;
  }
}

async function acceptQuest(context, user_data, quest, awaitCreation = false, db = null) {
  try {
    // console.log('[acceptQuest] Accepting quest:', quest, 'for user:', user_data?.github || user_data?.username);
    const quests = await getQuestConfigForUser(user_data);
    
    // check if quest exists in config
    if (quests[quest]) {
      // Check if quest is already completed
      if (user_data.completed && user_data.completed[quest]) {
        // console.log(`[acceptQuest] Quest ${quest} is already completed, skipping`);
        return false;
      }
      
      // if user has not accepted any quests
      if (!user_data.accepted) {
        user_data.accepted = {};
      }
      
      // Check if this specific quest is already accepted
      if (!user_data.accepted[quest]) {
        user_data.accepted[quest] = {};
        // add list of tasks to user in database
        for (const task in quests[quest]) {
          if (task !== "metadata") {
            user_data.accepted[quest][task] = {
              completed: false,
              attempts: 0,
              hints: 0,
              timeStart: 0,
              timeEnd: 0.0,
              issueNum: 0,
            };
          }
        }
        
          // track current progress
          user_data.current = {
            quest: quest,
            task: "T1", // depending on how indexing works in validate task, may need to change to 0
          };
          user_data.completion = 0;
        
        // Enhanced Quest System: Create first N tasks or fall back to single task
        if (isEnhancedQuestSystemEnabled()) {
          const orderedTasks = getOrderedTasks(quests[quest]);
          const bufferSize = getTaskBufferSize();
          const tasksToCreate = Math.min(bufferSize, orderedTasks.length);
          
          console.log(`[acceptQuest] 🌟 Enhanced Quest System: ${awaitCreation ? 'Creating' : 'Queueing'} first ${tasksToCreate} tasks for ${quest}`);
          
          if (awaitCreation) {
            // Create issues immediately and await them (for purple deploy)
            for (let i = 0; i < tasksToCreate; i++) {
              const taskId = orderedTasks[i];
              try {
                await createQuestEnvironment(user_data, quest, taskId, context);
                console.log(`[acceptQuest] ✅ Environment created for ${quest}.${taskId}`);
                // Small delay between creations to avoid rate limits
                if (i < tasksToCreate - 1) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              } catch (error) {
                console.error(`[acceptQuest] ❌ Failed to create environment for ${quest}.${taskId}:`, error.message);
              }
            }
          } else {
            // Queue initial task creation as LOW priority (background processing)
            const { priorityQueue } = await import('./services/priorityQueueService.js');
            const { owner, repo } = context.repo();
            
            for (let i = 0; i < tasksToCreate; i++) {
              const taskId = orderedTasks[i];
              const isLastTask = (i === tasksToCreate - 1);
              priorityQueue.enqueue('LOW', async () => {
                try {
                  await createQuestEnvironment(user_data, quest, taskId, context);
                  console.log(`[acceptQuest] ✅ Environment created for ${quest}.${taskId}`);
                  
                  // Update README after the last task issue is created to include all links
                  if (isLastTask && db) {
                    try {
                      console.log(`[acceptQuest] Updating README after creating all tasks for ${quest} in ${owner}/${repo}`);
                      await updateReadme(owner, repo, context, user_data, db);
                      console.log(`[acceptQuest] README updated successfully`);
                    } catch (readmeError) {
                      console.error(`[acceptQuest] Failed to update README:`, readmeError.message);
                    }
                  }
                } catch (error) {
                  console.error(`[acceptQuest] ❌ Failed to create environment for ${quest}.${taskId}:`, error.message);
                  throw error;
                }
              }, {
                type: 'quest_acceptance_issue_creation',
                quest: quest,
                task: taskId,
                user: user_data?.github || 'unknown',
                maxRetries: 3
              });
            }
          }
          
          console.log(`[acceptQuest] ✅ ${awaitCreation ? 'Created' : 'Queued'} ${tasksToCreate} task environments for ${quest}`);
        } else {
          // Legacy behavior: Create only first task
          console.log(`[acceptQuest] 🚀 ${awaitCreation ? 'Creating' : 'Queueing'} quest environment for ${quest}.T1...`);
          const { owner, repo } = context.repo();
          
          if (awaitCreation) {
            await createQuestEnvironment(user_data, quest, "T1", context);
            console.log(`[acceptQuest] ✅ Quest environment creation completed for ${quest}.T1`);
            // Update README immediately if awaitCreation is true
            if (db) {
              try {
                await updateReadme(owner, repo, context, user_data, db);
                console.log(`[acceptQuest] README updated successfully`);
              } catch (readmeError) {
                console.error(`[acceptQuest] Failed to update README:`, readmeError.message);
              }
            }
          } else {
            const { priorityQueue } = await import('./services/priorityQueueService.js');
            priorityQueue.enqueue('LOW', async () => {
              await createQuestEnvironment(user_data, quest, "T1", context);
              console.log(`[acceptQuest] ✅ Quest environment creation completed for ${quest}.T1`);
              
              // Update README after issue is created
              if (db) {
                try {
                  console.log(`[acceptQuest] Updating README after creating ${quest}.T1 in ${owner}/${repo}`);
                  await updateReadme(owner, repo, context, user_data, db);
                  console.log(`[acceptQuest] README updated successfully`);
                } catch (readmeError) {
                  console.error(`[acceptQuest] Failed to update README:`, readmeError.message);
                }
              }
            }, {
              type: 'quest_acceptance_issue_creation',
              quest: quest,
              task: 'T1',
              user: user_data?.github || 'unknown'
            });
          }
        }
        
        return true;
      } else {
        // Quest already accepted - check if we need to create environment
        // console.log(`[acceptQuest] Quest ${quest} is already accepted, checking if environment exists`);
        
        if (isEnhancedQuestSystemEnabled()) {
          // Enhanced system: Check if we need to create missing environments
          const orderedTasks = getOrderedTasks(quests[quest]);
          const bufferSize = getTaskBufferSize();
          const tasksToCreate = Math.min(bufferSize, orderedTasks.length);
          
          // Count how many tasks already have environments
          let tasksWithEnvironments = 0;
          for (let i = 0; i < tasksToCreate; i++) {
            const task = orderedTasks[i];
            if (user_data.accepted[quest][task] && user_data.accepted[quest][task].issueNum > 0) {
              tasksWithEnvironments++;
            }
          }
          
          if (tasksWithEnvironments < tasksToCreate) {
            console.log(`[acceptQuest] 🌟 Enhanced Quest System: Creating missing environments for ${quest} (${tasksWithEnvironments}/${tasksToCreate} exist)`);
            // Create environments for tasks that don't have them
            for (let i = 0; i < tasksToCreate; i++) {
              const task = orderedTasks[i];
              // Ensure task state exists before accessing issueNum
              if (!user_data.accepted[quest][task]) {
                user_data.accepted[quest][task] = {};
              }
              if (!user_data.accepted[quest][task].issueNum || user_data.accepted[quest][task].issueNum === 0) {
                try {
                  await createQuestEnvironment(user_data, quest, task, context);
                  console.log(`[acceptQuest] ✅ Created missing environment for ${quest}.${task}`);
                  if (i < tasksToCreate - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                  }
                } catch (error) {
                  console.error(`[acceptQuest] ❌ Failed to create environment for ${quest}.${task}:`, error.message);
                }
              }
            }
            return true;
          }
        } else {
          // Legacy behavior: Check if the first task has an issue number
          const firstTask = Object.keys(user_data.accepted[quest]).find(task => task !== "metadata");
          // Ensure task state exists before accessing issueNum
          if (firstTask && user_data.accepted[quest][firstTask]) {
            if (!user_data.accepted[quest][firstTask].issueNum || user_data.accepted[quest][firstTask].issueNum === 0) {
//           console.log(`[acceptQuest] Quest ${quest} accepted but no environment exists, creating now`);
            
            // Set current quest and task
            user_data.current = {
              quest: quest,
              task: firstTask,
            };
            
            // Create quest environment
            await createQuestEnvironment(user_data, quest, firstTask, context);
            return true;
            }
          }
        }
        
        // console.log(`[acceptQuest] Quest ${quest} already accepted and environment exists, skipping`);
        return false;
      }
    } else {
      // console.log(`[acceptQuest] Quest ${quest} not found in config`);
      return false;
    }
  } catch (error) {
    console.error("[acceptQuest] Error accepting quest: " + error);
    return false;
  }
}

export async function completeTask(user_data, quest, task, context, db, awardPoints = true) {
  const { owner, repo } = context.repo();
  try {
    const quests = await getQuestConfigForUser(user_data);

    const points = quests[quest][task].points;
    const xp = quests[quest][task].xp;

    // check user accepted quest and task
    if (
      user_data.accepted &&
      user_data.accepted[quest] &&
      user_data.accepted[quest][task]
    ) {
      // change quest data to complete
      user_data.accepted[quest][task].completed = true;
      user_data.accepted[quest][task].timeEnd = Date.now();
      user_data.accepted[quest][task].issueNum = context.issue().issue_number;

      // Award points and XP only if awardPoints is true
      if (awardPoints) {
      user_data.points += points;
      user_data.xp += xp;
      }

      // Calculate overall completion percentage across all quests
      user_data.completion = calculateOverallCompletion(user_data, quests);

      // Check if this quest is now complete
      const questComplete = await completeQuest(user_data, quest, context, db);
      
      // Close the current issue
      context.octokit.rest.issues.update({
        owner: owner,
        repo: repo,
        issue_number: context.issue().issue_number,
        state: "closed",
      });
      
      // Enhanced Quest System: Sliding window logic or Legacy: Sequential task creation
      if (!questComplete && isEnhancedQuestSystemEnabled()) {
        // Sliding window logic: maintain buffer of available tasks
        // Pass awaitCreation=true to ensure issues are created before README update
        await maintainTaskBuffer(user_data, quest, context, quests[quest], true);
        // Update README after task buffer is maintained and issues are created
        await updateReadme(owner, repo, context, user_data, db);
      } else if (!questComplete && user_data.current) {
        // Legacy behavior: Create next task sequentially (queued as LOW priority)
        const nextTaskIndex = taskIndex + 1;
        if (nextTaskIndex < tasks.length) {
          const nextTask = tasks[nextTaskIndex];
          user_data.current = {
            quest: quest,
            task: nextTask
          };
          
          // Queue environment creation for the next task as LOW priority
          // Update README AFTER the issue is created to include its link
          try {
            const { priorityQueue } = await import('./services/priorityQueueService.js');
            priorityQueue.enqueue('LOW', async () => {
              await createQuestEnvironment(user_data, quest, nextTask, context);
              console.log(`[completeTask] ✅ Next task environment created for ${quest}.${nextTask}`);
              
              // Update README after next task issue is created so the link appears
              console.log(`[completeTask] Calling updateReadme after next task creation for ${owner}/${repo}`);
              await updateReadme(owner, repo, context, user_data, db);
              console.log(`[completeTask] updateReadme completed`);
            }, {
              type: 'sequential_task_creation',
              quest: quest,
              task: nextTask,
              user: user_data?.github || 'unknown'
            });
          } catch (envError) {
            console.error(`⚠️ [completeTask] Failed to queue next task environment:`, envError.message);
            // If queueing fails, update README immediately anyway
            await updateReadme(owner, repo, context, user_data, db);
          }
        } else {
          // No next task, update README immediately
          await updateReadme(owner, repo, context, user_data, db);
        }
      } else {
        // Quest is complete or no current task, update README immediately
        await updateReadme(owner, repo, context, user_data, db);
      }

      // Note: Task environments are now created when quests are accepted, not sequentially
      // This allows users to work on any task in any order

      return true;
    }
    return false;
  } catch (error) {
    console.error("Error completing task:", error);
    return false;
  }
}

async function completeQuest(user_data, quest, context, db) {
  try {
//     console.log(`[completeQuest] Completing quest: ${quest}`);
    
    // Guard against multiple calls for the same quest
    if (user_data.completed && user_data.completed[quest]) {
//       console.log(`[completeQuest] Quest ${quest} is already completed, skipping`);
      return true;
    }
    
    // ASSUMES that user_data.accepted exsists (pre existing check in parent function)
    // all tasks completed
    const tasks_completed = Object.values(user_data.accepted[quest]).every(
      (task) => task.completed
    );

//     console.log(`[completeQuest] All tasks completed: ${tasks_completed}`);

    // clear quest and task
    if (tasks_completed) {
      if (!user_data.completed) {
        user_data.completed = {};
      }

      // add quest to users completed list
      user_data.completed[quest] = user_data.accepted[quest];
//       console.log(`[completeQuest] Added ${quest} to completed list`);

      delete user_data.accepted;
      delete user_data.current;
//       console.log(`[completeQuest] Cleared accepted and current quest data`);

      // DYNAMIC quest progression: unlock all quests whose prerequisite is the completed quest
      const questsConfig = await getQuestConfigForUser(user_data);
//       console.log(`[completeQuest] Checking for quests with prerequisite: ${quest}`);
//       console.log(`[completeQuest] Available quests:`, Object.keys(questsConfig));
//       console.log(`[completeQuest] User customGroupId:`, user_data.customGroupId);
//       console.log(`[completeQuest] Quest config source:`, user_data.customGroupId ? 'custom group' : 'default');
      
      const { owner, repo } = context.repo();
      let questsUnlocked = 0;
      for (const [questKey, questObj] of Object.entries(questsConfig)) {
//         console.log(`[completeQuest] Checking ${questKey}: prerequisite = ${questObj.metadata?.prerequisite}`);
        if (
          questObj.metadata &&
          questObj.metadata.prerequisite === quest
        ) {
//           console.log(`[completeQuest] Unlocking quest: ${questKey}`);
          const accepted = await acceptQuest(context, user_data, questKey, false, db);
//           console.log(`[completeQuest] Quest ${questKey} accepted: ${accepted}`);
          if (accepted) {
            questsUnlocked++;
          }
        }
      }
      
//       console.log(`[completeQuest] Total quests unlocked: ${questsUnlocked}`);
      
      // Update README after unlocking next quest(s) to include their links
      // Note: Issues are created asynchronously, so we queue README update after a short delay
      if (questsUnlocked > 0) {
        const { priorityQueue } = await import('./services/priorityQueueService.js');
        priorityQueue.enqueue('LOW', async () => {
          // Wait a bit for issues to be created
          await new Promise(resolve => setTimeout(resolve, 2000));
          try {
            console.log(`[completeQuest] Updating README after unlocking ${questsUnlocked} quest(s) for ${owner}/${repo}`);
            await updateReadme(owner, repo, context, user_data, db);
            console.log(`[completeQuest] README updated successfully`);
          } catch (readmeError) {
            console.error(`[completeQuest] Failed to update README after quest unlock:`, readmeError.message);
          }
        }, {
          type: 'readme_update_after_quest_unlock',
          quest: quest,
          user: user_data?.github || 'unknown'
        });
      }

      return true; // Quest successfully completed
    } else {
//       console.log(`[completeQuest] Not all tasks completed, quest not finished`);
    }
  } catch (error) {
    console.error("Error completing quest:", error);
  }
  return false; // Quest not completed
}

// Helper function to log bot quest environment metrics
function logBotQuestEnvironmentMetrics(quest, task, username, metrics) {
  console.log(`📊 [BOT-QUEST-ENV-METRICS] ${quest}.${task} for ${username}:`, {
    successful: metrics.successful,
    retryAttempts: metrics.retryAttempts || 0,
    processingTime: metrics.processingTime ? `${metrics.processingTime}ms` : 'N/A',
    issueNumber: metrics.issueNumber || 'N/A'
  });
}

// Helper function to retry with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`🔄 [RETRY] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// geenrates "quest" by generating a github issues with the quest details
async function createQuestEnvironment(user_data, quest, task, context) {
  const { owner, repo } = context.repo();
  const startTime = Date.now();
  const username = user_data?.github || user_data?.username;
  
  try {
    console.log(`[createQuestEnvironment] 🔍 Creating environment for: ${quest}.${task}, user: ${username}`);
    
    // Enhanced check: Verify if this quest/task already has an issue created
    if (user_data.accepted && user_data.accepted[quest] && user_data.accepted[quest][task] && !user_data.accepted[quest][task].completed && user_data.accepted[quest][task].issueNum && user_data.accepted[quest][task].issueNum > 0) {
      console.log(`[createQuestEnvironment] ⏭️ Issue already exists for ${quest}.${task} (issue #${user_data.accepted[quest][task].issueNum}), skipping`);
      return { successful: true, issueNumber: user_data.accepted[quest][task].issueNum, skipped: true };
    }

    // Enhanced GitHub API verification with retry mechanism
    let duplicateIssue = null;
    try {
      duplicateIssue = await retryWithBackoff(async () => {
        const existingIssues = await context.octokit.rest.issues.listForRepo({
          owner: owner,
          repo: repo,
          state: 'all', // Check both open and closed issues
          per_page: 100
        });
        
        // Look for issues that match this quest/task pattern
        // Support both "Q1.T4" and "...-Q1 T4: ..." formats
        const questTaskPattern = new RegExp(`\\b${quest}\\s*(?:[\\.]|\\s+)\\s*${task}\\b`, 'i');
        let foundIssue = existingIssues.data.find(issue => {
          // Ignore archived issues by label
          const hasArchivedLabel = Array.isArray(issue.labels) && issue.labels.some(l => {
            const name = typeof l === 'string' ? l : l?.name;
            return name && name.toLowerCase().includes('archived');
          });
          if (hasArchivedLabel) return false;
          return questTaskPattern.test(issue.title) || questTaskPattern.test(issue.body);
        });
        
        if (!foundIssue) {
          // Try parsing the standardized title format: GroupId-Qn Tm: Title
          foundIssue = existingIssues.data.find(issue => {
            // Ignore archived issues by label
            const hasArchivedLabel = Array.isArray(issue.labels) && issue.labels.some(l => {
              const name = typeof l === 'string' ? l : l?.name;
              return name && name.toLowerCase().includes('archived');
            });
            if (hasArchivedLabel) return false;
            const m = issue.title.match(/^(.+?)-Q(\d+)\s+T(\d+):/i);
            if (!m) return false;
            const [, , qNum, tNum] = m;
            const qId = `Q${qNum}`;
            const tId = `T${tNum}`;
            return qId.toUpperCase() === quest.toUpperCase() && tId.toUpperCase() === task.toUpperCase();
          });
        }
        
        return foundIssue;
      }, 3, 2000);
      
      if (duplicateIssue) {
        console.log(`[createQuestEnvironment] 🔍 Found existing issue #${duplicateIssue.number} for ${quest}.${task}, updating user_data and skipping creation`);
        
        // Update user_data to track this existing issue
        if (!user_data.accepted) user_data.accepted = {};
        if (!user_data.accepted[quest]) user_data.accepted[quest] = {};
        if (!user_data.accepted[quest][task]) user_data.accepted[quest][task] = {};
        user_data.accepted[quest][task].issueNum = duplicateIssue.number;
        
        const metrics = {
          successful: true,
          issueNumber: duplicateIssue.number,
          skipped: true,
          processingTime: Date.now() - startTime
        };
        logBotQuestEnvironmentMetrics(quest, task, username, metrics);
        return metrics;
      }
    } catch (searchError) {
      console.warn(`[createQuestEnvironment] ⚠️ Could not search for existing issues (proceeding with creation):`, searchError.message);
    }

    console.log(`[createQuestEnvironment] 📝 No existing issue found, proceeding to create...`);
    
    // Using global var quests and checking if in quest_config
    const quests = await getQuestConfigForUser(user_data);
    if (quests[quest]) {
      const questData = quests[quest];
      
      // Get accept message directly from quest config (accept message now contains full quiz content)
      let response;
      if (questData[task] && questData[task].accept) {
        response = questData[task].accept;
        console.log(`[createQuestEnvironment] ✅ Using accept message from database quest config for ${quest}.${task} (${response.length} characters)`);
        console.log(`[createQuestEnvironment] 📄 Accept message preview: ${response.substring(0, 200)}...`);
      } else {
        // Fallback if no accept message found
        response = questResponse[quest]?.[task]?.accept || 'Task description not found';
        console.warn(`[createQuestEnvironment] ⚠️ FALLBACK: Using default accept message for ${quest}.${task} - quest config may be incomplete`);
      }

      // Initialize the quest and task in user_data.accepted if they don't exist
      if (!user_data.accepted) user_data.accepted = {};
      if (!user_data.accepted[quest]) user_data.accepted[quest] = {};
      if (!user_data.accepted[quest][task]) user_data.accepted[quest][task] = {};

      let title;
      if (questData[task]) {
        // Assign the start time once the structure is confirmed to exist
        user_data.accepted[quest][task].timeStart = Date.now();
        title = questData[task].desc;
        console.log(`[createQuestEnvironment] 🏷️ Task title: ${title}`);
      }

      // Get original class name from database (preserves original case)
      let classTitle = null;
      if (user_data.customGroupId) {
        classTitle = await getOriginalClassName(user_data.customGroupId);
      }
      
      // Fallback to extracting from repo name if database lookup fails
      if (!classTitle) {
        classTitle = repo.split('-').slice(1).join('-') || repo.replace(/[^a-zA-Z0-9]+/g, '').replace(/^-+|-+$/g, '');
        console.log(`[createQuestEnvironment] Using fallback class title from repo: ${classTitle}`);
      } else {
        console.log(`[createQuestEnvironment] Using original class name from database: ${classTitle}`);
      }
      
      // Extract quest number from quest ID (e.g., Q1 -> 1, Q2 -> 2)
      let questNumber = 1;
      const questIdMatch = quest && quest.match(/Q(\d+)/i);
      if (questIdMatch) questNumber = parseInt(questIdMatch[1], 10);
      
      // Extract task number from task ID (e.g., T1 -> 1, T2 -> 2)
      let taskNumber = 1;
      const taskIdMatch = task && task.match(/T(\d+)/i);
      if (taskIdMatch) taskNumber = parseInt(taskIdMatch[1], 10);
      
      // Create issue with retry mechanism
      console.log(`[createQuestEnvironment] 🚀 Creating GitHub issue for ${quest}.${task}...`);
      
      const issueResponse = await retryWithBackoff(async () => {
        return await context.octokit.rest.issues.create({
          owner: owner,
          repo: repo,
          title: `${classTitle}-Q${questNumber} T${taskNumber}: ${title}`,
          body: response,
        });
      }, 3, 2000);
      
      // Verify issue was created successfully
      if (!issueResponse || !issueResponse.data || !issueResponse.data.number) {
        throw new Error(`Failed to create issue for ${quest}.${task} - no issue number returned`);
      }
      
      // Store the issue number to prevent duplicates
      if (user_data.accepted[quest] && user_data.accepted[quest][task]) {
        user_data.accepted[quest][task].issueNum = issueResponse.data.number;
        console.log(`[createQuestEnvironment] ✅ Created issue #${issueResponse.data.number} for ${quest}.${task}`);
      }
      
      const metrics = {
        successful: true,
        issueNumber: issueResponse.data.number,
        processingTime: Date.now() - startTime
      };
      logBotQuestEnvironmentMetrics(quest, task, username, metrics);
      return metrics;
      
    } else {
      console.error(`[createQuestEnvironment] ❌ Quest ${quest} not found in config`);
      const metrics = {
        successful: false,
        error: 'Quest not found in config',
        processingTime: Date.now() - startTime
      };
      logBotQuestEnvironmentMetrics(quest, task, username, metrics);
      return metrics;
    }
  } catch (error) {
    console.error('[createQuestEnvironment] Error:', error);
    const metrics = {
      successful: false,
      error: error.message,
      processingTime: Date.now() - startTime
    };
    logBotQuestEnvironmentMetrics(quest, task, username, metrics);
    return metrics;
  }
}

async function giveHint(user_data, context, db) {
  // Check if user has a current quest/task assigned
  if (!user_data.current || !user_data.current.quest || !user_data.current.task) {
    console.log('[giveHint] No current quest/task assigned to user');
    return '❌ **No Active Quest**\n\nYou don\'t have any active quest or task assigned. Please start a quest first.';
  }
  
  const quest = user_data.current.quest;
  const task = user_data.current.task;
  var response = '';

  // user hints used
  if (!("hints" in user_data.accepted[quest][task])) {
    user_data.accepted[quest][task].hints = 0;
  }
  const hints = user_data.accepted[quest][task].hints;
  
  // Use the user's custom quest config for hints
  let hintResponse = null;
  
  // First try to get hints from the user's unique quest config
  const userQuestConfig = await getQuestConfigForUser(user_data);
  if (userQuestConfig && userQuestConfig[quest] && userQuestConfig[quest][task] && userQuestConfig[quest][task].detailedHints) {
    const detailedHints = userQuestConfig[quest][task].detailedHints;
    
    // Try to find hint by sequence number first, otherwise use array index
    let hint = detailedHints.find(h => h.sequence === (hints + 1));
    
    // If no sequence-based hint found, try using array index
    if (!hint && detailedHints.length > hints) {
      hint = detailedHints[hints];
    }
    
    if (hint) {
      let hintContent = hint.content;
      if (hint.image) {
        hintContent += `\n![image](${hint.image})`;
      }
      if (hint.video) {
        hintContent += `\n[Watch Video](${hint.video})`;
      }
      hintResponse = {
        content: hintContent,
        penalty: hint.penalty || 0
      };
    }
  }
  
  // If no custom/detailed hint is configured, do NOT generate default hints.
  // This ensures the bot clearly reports when no hints exist for the task.
  // Leave hintResponse as null so the "No Hints Available" message is used.
 
   if (hintResponse == null) {
     // No hints available - show appropriate message instead of generating default hint
     response = `💡 **No Hints Available**
 
 There are no hints configured for this task. Please review the question carefully and try again.
 
 **Tip:** Read the task description thoroughly and make sure you understand what is being asked.`;
   }
   else {
 //     console.log(`${quest},${task}`);
     var newHintResponse = await llmInstance.rewordHint(`${hintResponse.content}`);
     response += `${newHintResponse}`;
     user_data.points -= hintResponse.penalty; // Use penalty from hint config
     user_data.accepted[quest][task].hints += 1;
   }
 
 
   var issueComment = context.issue({
     body: response,
   });
   await context.octokit.rest.issues.createComment(issueComment);
 
 }

// 

// validates task by using object oriented function mapping from the taskMapping.js file
// Helper function to detect quest and task from issue context
async function detectQuestAndTaskFromIssue(user_data, context) {
  try {
    const { owner, repo } = context.repo();
    const issueNumber = context.issue().issue_number;
    
    console.log(`[detectQuestAndTaskFromIssue] Detecting quest/task for issue #${issueNumber} in ${owner}/${repo}`);
    
    // Check if this is a PR comment for bot-code-review task
    // PRs are also issues, so check botCodeReviewState for PR number
    if (user_data.storedValues?.botCodeReviewState) {
      for (const [questId, questData] of Object.entries(user_data.storedValues.botCodeReviewState)) {
        if (questData && typeof questData === 'object') {
          for (const [taskId, taskState] of Object.entries(questData)) {
            if (taskState && typeof taskState === 'object' && taskState.prInfo) {
              if (taskState.prInfo.prNumber === issueNumber && 
                  taskState.prInfo.owner === owner && 
                  taskState.prInfo.repo === repo) {
                console.log(`[detectQuestAndTaskFromIssue] Found bot-code-review PR match: ${questId}.${taskId} for PR #${issueNumber}`);
                return { quest: questId, task: taskId };
              }
            }
          }
        }
      }
    }
    
    // Check if this is a PR comment for iterative-code-review task
    // PRs are also issues, so check codeReviewState for PR number
    if (user_data.storedValues?.codeReviewState) {
      for (const [questId, questData] of Object.entries(user_data.storedValues.codeReviewState)) {
        if (questData && typeof questData === 'object') {
          for (const [taskId, taskState] of Object.entries(questData)) {
            if (taskState && typeof taskState === 'object' && taskState.prInfo) {
              if (taskState.prInfo.prNumber === issueNumber && 
                  taskState.prInfo.owner === owner && 
                  taskState.prInfo.repo === repo) {
                console.log(`[detectQuestAndTaskFromIssue] Found iterative-code-review PR match: ${questId}.${taskId} for PR #${issueNumber}`);
                return { quest: questId, task: taskId };
              }
            }
          }
        }
      }
    }
    
    // Search through all accepted and completed quests to find the issue
    const allQuests = { ...user_data.accepted, ...user_data.completed };
    
    for (const [questId, questData] of Object.entries(allQuests)) {
      if (questData && typeof questData === 'object') {
        for (const [taskId, taskData] of Object.entries(questData)) {
          if (taskData && typeof taskData === 'object' && taskData.issueNum === issueNumber) {
            console.log(`[detectQuestAndTaskFromIssue] Found match: ${questId}.${taskId} for issue #${issueNumber}`);
            return { quest: questId, task: taskId };
          }
        }
      }
    }
    
    // Try to detect from issue title and create task on-demand (always attempt)
    const issueTitle = context.payload.issue?.title || '';
    console.log(`[detectQuestAndTaskFromIssue] Attempting to parse issue title: "${issueTitle}"`);
    
    // Parse issue title format: "GroupId-Q1 T1: Task description"
    const titleMatch = issueTitle.match(/^(.+?)-Q(\d+)\s+T(\d+):\s*(.+)$/i);
    
    if (titleMatch) {
      const [, groupId, questNum, taskNum, taskDesc] = titleMatch;
      const questId = `Q${questNum}`;
      const taskId = `T${taskNum}`;
      
      console.log(`[detectQuestAndTaskFromIssue] Parsed from title: ${questId}.${taskId} (${groupId})`);
      
      // Try to create task on-demand if it doesn't exist
      const onDemandResult = await createTaskOnDemand(user_data, questId, taskId, issueNumber, context);
      if (onDemandResult) {
        console.log(`[detectQuestAndTaskFromIssue] Created task on-demand: ${questId}.${taskId}`);
        return { quest: questId, task: taskId };
      }
    }
    
    console.log(`[detectQuestAndTaskFromIssue] No quest/task found for issue #${issueNumber}`);
    return null;
  } catch (error) {
    console.error(`[detectQuestAndTaskFromIssue] Error detecting quest/task:`, error);
    return null;
  }
}

// validates task by using object-oriented function mapping from the taskMapping.js file
async function validateTask(user_data, context, user, db) {
  try {
    // issue context
    const selectedIssue = user_data.selectedIssue;
    
    // Try to detect quest and task from the issue being commented on
    const detectedTask = await detectQuestAndTaskFromIssue(user_data, context);
    
    let task, quest;
    
    if (detectedTask) {
      // Use detected quest/task from issue
      quest = detectedTask.quest;
      task = detectedTask.task;
      console.log(`[validateTask] Using detected quest/task: ${quest}.${task}`);
    } else {
      // Fallback to current quest/task if detection fails
      if (!user_data.current) {
        console.error('user_data.current is null or undefined and no quest/task detected from issue');
        const issueComment = context.issue({
          body: `❌ Error: No active quest found and could not detect quest/task from issue. Please use the /new_user command to set up your quest system.`
        });
        await context.octokit.rest.issues.createComment(issueComment);
        return;
      }
      
      task = user_data.current.task;
      quest = user_data.current.quest;
      console.log(`[validateTask] Using fallback current quest/task: ${quest}.${task}`);
    }
    
    const { owner, repo } = context.repo();
    const ossRepo = `${owner}/${repo}`;

    // Add detailed logging
//     console.log('--- validateTask START ---');
//     console.log('quest:', quest, 'task:', task);
//     console.log('selectedIssue:', selectedIssue);
//     console.log('ossRepo:', ossRepo);

    // check if quest is in accepted or completed
    const questData = user_data.accepted[quest] || user_data.completed[quest];
//     console.log('questData keys:', questData ? Object.keys(questData) : 'questData is undefined');
//     console.log('task:', task);
//     console.log('questData[task]:', questData ? questData[task] : 'questData is undefined');

    // increment attempt and update streak BEFORE handler
    if (questData && questData[task]) {
      questData[task].attempts += 1;
//       console.log('Incremented attempts:', questData[task].attempts);

      // update streak
      if (user_data.streakCount != null) {
        // no failed attempt
        if (questData[task].attempts <= 1) {
          user_data.currentStreak += 1;
//           console.log('currentStreak incremented:', user_data.currentStreak);
          // check if streak is full (remove hardcode later)
          if (user_data.currentStreak > 2) {
            user_data.currentStreak = 0;
            user_data.streakCount += 1;
//             console.log('streakCount incremented:', user_data.streakCount);
          }
        } else {
          // failed, reset streak
          user_data.currentStreak = 0;
//           console.log('currentStreak reset to 0');
        }
      } else {
        // no previous streak
        user_data.streakCount = 0;
        user_data.currentStreak = 1;
//         console.log('Initialized streakCount and currentStreak');
      }
    } else {
      console.error('questData or questData[task] is undefined:', { questData, task });
      // Instead of throwing, return a helpful comment and exit
      const issueComment = context.issue({
        body: `❌ Error: Could not find quest or task data for quest '${quest}' and task '${task}'. Please contact an administrator.`
      });
      await context.octokit.rest.issues.createComment(issueComment);
      return;
    }

    // validate current task
    const userQuestConfig = await getQuestConfigForUser(user_data);
    const dynamicTaskMapping = buildDynamicTaskMapping(userQuestConfig);
    
    // Debug logging
//     console.log(`[validateTask] Quest: ${quest}, Task: ${task}`);
//     console.log(`[validateTask] Dynamic task mapping for ${quest}.${task}:`, dynamicTaskMapping[quest]?.[task] ? 'EXISTS' : 'NOT FOUND');
//     console.log(`[validateTask] Static task mapping for ${quest}.${task}:`, taskMapping[quest]?.[task] ? 'EXISTS' : 'NOT FOUND');
    
    // ALWAYS prioritize dynamic task mapping over static task mapping
    // This ensures custom task types like llm-text-validation are handled correctly
    const taskHandler = dynamicTaskMapping[quest]?.[task] || taskMapping[quest]?.[task];
    
//     console.log(`[validateTask] Selected task handler:`, dynamicTaskMapping[quest]?.[task] ? 'DYNAMIC' : 'STATIC');
    
    // FORCE use of quest config format for now until questSequence format is properly implemented
    // Get response templates directly from quest config
    console.log(`[validateTask] Getting response from quest config for ${quest}.${task}`);
    const taskQuestData = userQuestConfig[quest];
    let response;
    if (taskQuestData && taskQuestData[task]) {
      let errorMessage = taskQuestData[task].error || '❌ Incorrect. Please try again.';
      
      // Check if hints are available for this task
      const hasHints = Array.isArray(taskQuestData[task].detailedHints) && taskQuestData[task].detailedHints.length > 0;
      
      // If no hints are available, remove the "help" suggestion from error message
      if (!hasHints && errorMessage.includes('help')) {
        errorMessage = errorMessage.replace(/You can type ["']help["'] for additional guidance\.?/gi, '');
        errorMessage = errorMessage.replace(/don't forget that you can type ["']help["'] to get hints\.?/gi, '');
        errorMessage = errorMessage.replace(/If you need help, don't forget that you can type ["']help["'] to get hints\.?/gi, '');
        errorMessage = errorMessage.replace(/If you need help, don't forget that you can type ["']help["'] for additional guidance\.?/gi, '');
        errorMessage = errorMessage.replace(/If you need help, don't forget that you can type ["']help["']\.?/gi, '');
        // Clean up any extra whitespace or newlines
        errorMessage = errorMessage.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      }
      
      response = {
        success: taskQuestData[task].success || '✅ Correct!',
        error: errorMessage
      };
      console.log(`[validateTask] Quest config response preview:`, { 
        success: response.success?.substring(0, 100), 
        error: response.error?.substring(0, 100),
        hasHints: hasHints
      });
    } else {
      console.log(`[validateTask] No quest data found, using defaults`);
      response = {
        success: '✅ Correct!',
        error: '❌ Incorrect. Please try again.'
      };
    }
    
    let success = null;
//     console.log('taskHandler:', typeof taskHandler);
    
    if (!taskHandler) {
      console.error(`No task handler found for ${quest}.${task}`);
      const issueComment = context.issue({
        body: `❌ Error: No task handler found for quest '${quest}' and task '${task}'. Please contact an administrator.`
      });
      await context.octokit.rest.issues.createComment(issueComment);
      return;
    }
    
    let result = await taskHandler(
      user_data,
      user,
      context,
      ossRepo,
      response,
      selectedIssue,
      db
    );
//     console.log('taskHandler result:', result);

    response = result[0];
    success = result[1];
    
    console.log(`[validateTask] Handler returned - success: ${success}, response type: ${typeof response}, response length: ${response ? response.length : 0}`);

    // Handle cases where taskHandler returns undefined or null response
    if (!response) {
      console.error(`Task handler returned undefined or null response for ${quest}.${task}`);
      response = '❌ Error: Task handler returned an invalid response. Please contact an administrator.';
      success = false;
    }

    try {
//       console.log('[validateTask] storedValues (pre-save):', user_data?.storedValues);
    } catch (_) {}

    // Re-fetch questData in case it was mutated by completeTask
    const questDataAfter = user_data.accepted?.[quest] || user_data.completed?.[quest];
//     console.log('questDataAfter keys:', questDataAfter ? Object.keys(questDataAfter) : 'questDataAfter is undefined');

    // detect if user used a hint - use quest config directly instead of getQuestResponse
    if (success) {
      if (questDataAfter && questDataAfter[task] && questDataAfter[task].hints > 0) {
        // Get hints response from quest config
        if (taskQuestData && taskQuestData[task] && taskQuestData[task].hints) {
          response += taskQuestData[task].hints;
          console.log(`[validateTask] Added hints response from quest config for ${quest}.${task}`);
        }
//         console.log('User used hints:', questDataAfter[task].hints);
      } else if (questDataAfter && questDataAfter[task]) {
        // Get noHints response from quest config
        if (taskQuestData && taskQuestData[task] && taskQuestData[task].noHints) {
          response += taskQuestData[task].noHints;
          console.log(`[validateTask] Added noHints response from quest config for ${quest}.${task}`);
        }
//         console.log('User did not use hints');
      } else {
//         console.log('No questDataAfter or questDataAfter[task] after taskHandler');
      }
    }

    // Robustly set hintsUsed
    let hintsUsed = 0;
    if (questDataAfter && questDataAfter[task]) {
      hintsUsed = questDataAfter[task].hints || 0;
    } else {
//       console.log('hintsUsed fallback: questDataAfter or questDataAfter[task] missing');
    }
//     console.log('Final hintsUsed:', hintsUsed);

    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    let experiencePoints;
    
    console.log(`[validateTask] Quest config loaded:`, questConfig ? 'SUCCESS' : 'FAILED');
    console.log(`[validateTask] Quest config keys:`, questConfig ? Object.keys(questConfig) : 'N/A');
    
    if (!questConfig || !questConfig[quest] || !questConfig[quest][task]) {
      console.error(`[validateTask] Quest or task not found in config: quest=${quest}, task=${task}`);
      return [response.error, false];
    }
    
    console.log(`[validateTask] Found quest: ${quest}, task: ${task}`);
    experiencePoints = questConfig[quest][task].xp;
    
    const currentPoints = user_data.points;
    const level = Math.ceil(currentPoints / 100);
    const nextLevelPointsNeeded = level * 100; 
    const remainingPoints = (nextLevelPointsNeeded - currentPoints);
    const completionPercent = user_data.completion * 100;

    // replace placeholders in response
    response = response
      .replaceAll("${experiencePoints}", experiencePoints)
      .replaceAll("${currentPoints}", currentPoints)
      .replaceAll("${pointsRemaining}", remainingPoints)
      .replaceAll("${completionRate}", completionPercent)
      .replaceAll("${hintsUsed}", hintsUsed)
      .replaceAll("${pointLoss}", hintsUsed * -5);

    // Generate appropriate navigation text based on current position
    // Only show progression navigation if the task was completed successfully
    if (success) {
      // Task completed successfully - show progression options
      const navigationText = getNavigationText(quest, task, questConfig, owner, repo, user_data);
      response += `\n\n${navigationText}`;
    }
    // If task failed, don't add any navigation - user stays on current task

    // Enhanced Quest System: Maintain task buffer regardless of success/failure
    console.log(`[validateTask] 🔍 Debug - Enhanced enabled: ${isEnhancedQuestSystemEnabled()}, userQuestConfig exists: ${!!userQuestConfig}`);
    if (isEnhancedQuestSystemEnabled() && userQuestConfig) {
      try {
        console.log(`[validateTask] 🔄 Maintaining task buffer after validation (success: ${success})`);
        const questConfigForCurrent = userQuestConfig && userQuestConfig[quest] ? userQuestConfig[quest] : null;
        if (questConfigForCurrent) {
          await maintainTaskBuffer(user_data, quest, context, questConfigForCurrent);
        } else {
          console.warn(`[validateTask] ⚠️ Missing quest config for ${quest} when maintaining buffer`);
        }
      } catch (bufferError) {
        console.error(`[validateTask] ❌ Failed to maintain task buffer:`, bufferError.message);
      }
    } else {
      console.log(`[validateTask] ⚠️ Skipping buffer maintenance - Enhanced: ${isEnhancedQuestSystemEnabled()}, Config: ${!!userQuestConfig}`);
    }

    // post the response as a comment on the issue
    // Skip posting if response is just '.' (marker that handler already posted to PR)
    console.log(`[validateTask] Preparing to post response. Response length: ${response ? response.length : 0}, trimmed length: ${response ? response.trim().length : 0}`);
    if (response && response.trim() !== '.' && response.trim().length > 0) {
      try {
    const issueComment = context.issue({
      body: response,
    });
        console.log(`[validateTask] Posting comment to issue #${selectedIssue || 'unknown'}`);
    await context.octokit.rest.issues.createComment(issueComment);
        console.log(`[validateTask] ✅ Successfully posted comment`);
      } catch (commentError) {
        console.error(`[validateTask] ❌ Failed to post comment:`, commentError);
        console.error(`[validateTask] Comment error stack:`, commentError.stack);
        // Don't throw - we've already logged the error
      }
    } else if (response === '.') {
      console.log(`[validateTask] Skipping comment post - handler already posted to PR (response was '.' marker)`);
    } else {
      console.warn(`[validateTask] ⚠️ Not posting comment - response is empty or invalid. Response:`, response ? `"${response.substring(0, 100)}..."` : 'null/undefined');
    }
//     console.log('--- validateTask END ---');
  } catch (error) {
    console.error("Error validating task: " + error);
    console.error(error.stack);
  }
}


/////////////////////////////////
/* ----- FRONT END (ish) ----- */
/////////////////////////////////

// Helper function to fetch class-level data from management backend with local fallback
async function fetchClassData(classId, db) {
  try {
    // Extract base class ID (remove _purple_ or _timestamp suffixes)
    // Example: 68a770b8140b9c0174c13ce7_purple_1760378826454 -> 68a770b8140b9c0174c13ce7
    const baseClassId = classId.split('_')[0];
    const cacheKey = `class-metrics-${baseClassId}`;
    
    console.log(`📊 [fetchClassData] Original classId: ${classId}`);
    console.log(`📊 [fetchClassData] Base classId: ${baseClassId}`);
    
    // Check cache first (30 minute TTL)
    if (ConfigService.has(cacheKey)) {
      const cachedMetrics = ConfigService.get(cacheKey);
      console.log(`✅ [fetchClassData] Cache HIT for class metrics (${cachedMetrics.length} students)`);
      return cachedMetrics;
    }
    
    console.log(`🐌 [fetchClassData] Cache MISS for class metrics, fetching fresh data...`);
    
    const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';
    const axios = (await import('axios')).default;
    
    let classStudents = [];
    
    // Try to fetch from management backend first
    try {
      const response = await axios.get(`${baseURL}/api/group/${baseClassId}/students`, {
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data && response.data.success) {
        classStudents = response.data.data || [];
        console.log(`✅ [fetchClassData] Found ${classStudents.length} students in class from management backend`);
      }
    } catch (backendError) {
      console.warn(`⚠️ [fetchClassData] Management backend failed: ${backendError.message}`);
    }
    
    // Fallback: Generate class data from local database
    if (!classStudents || classStudents.length === 0) {
      console.log(`🔄 [fetchClassData] Falling back to local database for class metrics`);
      classStudents = await generateClassDataFromLocal(classId, db);
    }
    
    // Cache the result for 30 minutes (1800000 ms)
    if (classStudents && classStudents.length > 0) {
      ConfigService.set(cacheKey, classStudents, 1800000);
      console.log(`💾 [fetchClassData] Cached class metrics for ${classStudents.length} students (30 min TTL)`);
    }
    
    return classStudents;
    
  } catch (error) {
    console.error(`❌ [fetchClassData] Error fetching class data: ${error.message}`);
    return [];
  }
}

// Helper function to generate class data from local database
async function generateClassDataFromLocal(classId, db) {
  try {
    const baseClassId = classId.split('_')[0];
    console.log(`📊 [generateClassDataFromLocal] Using base class ID: ${baseClassId}`);
    
    // Load quest config to get dynamic total tasks (same as calculateOverallCompletion)
    const questConfigCollection = db.db.collection('questconfigs');
    let questConfig = null;
    let totalTasksInCourse = 150; // Default fallback
    
    try {
      // Try to find quest config - same query as ConfigService (using groupId/configId/classId fields)
      questConfig = await questConfigCollection.findOne({
        $or: [
          { groupId: classId },
          { configId: classId },
          { classId: classId }
        ]
      });
      
      // If not found with full classId, try base classId
      if (!questConfig) {
        questConfig = await questConfigCollection.findOne({
          $or: [
            { groupId: baseClassId },
            { configId: baseClassId },
            { classId: baseClassId }
          ]
        });
      }
      
      if (questConfig) {
        // Extract quest data from the document (could be in config, configData, or root level)
        const questData = questConfig.config || questConfig.configData || questConfig;
        let calculatedTotal = 0;
        
        Object.entries(questData).forEach(([questId, questContent]) => {
          if (questId === '_id' || questId === 'map_repo_link' || !questContent || typeof questContent !== 'object') {
            return;
          }
          const taskCount = Object.keys(questContent).filter(key => /^T\d+$/i.test(key)).length;
          calculatedTotal += taskCount;
        });
        
        if (calculatedTotal > 0) {
          totalTasksInCourse = calculatedTotal;
          console.log(`📊 [generateClassDataFromLocal] Using dynamic total: ${totalTasksInCourse} tasks from quest config`);
        }
      } else {
        console.log(`⚠️ [generateClassDataFromLocal] Quest config not found, using fallback: ${totalTasksInCourse} tasks`);
      }
    } catch (configError) {
      console.warn(`⚠️ [generateClassDataFromLocal] Error loading quest config: ${configError.message}`);
    }
    
    // Use optimized query to fetch only users in this class (with projection)
    const classUsers = await db.getUsersByClassId(baseClassId);
    console.log(`📊 [generateClassDataFromLocal] Found ${classUsers.length} users in class (optimized query)`);
    
    // Convert to management backend format with optimized completion calculation
    const classStudents = classUsers.map(user => {
      // Count completed tasks (same logic as calculateOverallCompletion)
      // Support both 'completed' and 'accepted' fields for backwards compatibility
      let completedTaskCount = 0;
      
      const completionData = user.user_data?.completed || user.user_data?.accepted;
      
      if (completionData) {
        Object.values(completionData).forEach(questData => {
          if (questData && typeof questData === 'object') {
            Object.values(questData).forEach(taskData => {
              if (taskData && taskData.completed === true) {
                completedTaskCount++;
              }
            });
          }
        });
      }
      
      // Use DYNAMIC total tasks (same as calculateOverallCompletion)
      // Don't cap - students can exceed 100% if they complete extra credit
      const completion = completedTaskCount / totalTasksInCourse;
      
      return {
        githubUsername: user.user_data?.github || user.user_data?.username || 'unknown',
        completion: completion,
        points: user.user_data?.points || 0,
        xp: user.user_data?.xp || 0
      };
    });
    
    console.log(`✅ [generateClassDataFromLocal] Generated class data for ${classStudents.length} students using ${totalTasksInCourse} total tasks`);
    return classStudents;
    
  } catch (error) {
    console.error(`❌ [generateClassDataFromLocal] Error generating class data: ${error.message}`);
    return [];
  }
}

// Helper function to calculate class percentile rank
function calculateClassPercentile(userCompletion, classStudents, userPoints = 0) {
  if (!classStudents || classStudents.length === 0) {
    return { percentile: 50, display: 'Top 50%', color: '#2f80ed', topPercent: 50, medal: '' };
  }
  
  // Count students with STRICTLY better performance (same logic as list-class-ranks.js)
  const studentsBetter = classStudents.filter(s => {
    const sCompletion = (s.completion || 0) * 100; // Convert to percentage
    const sPoints = s.points || 0;
    
    // Better if higher completion, or same completion but more points
    if (sCompletion > userCompletion) {
      return true;
    } else if (sCompletion === userCompletion && sPoints > userPoints) {
      return true;
    }
    return false;
  }).length;
  
  // Calculate percentile
  const percentile = Math.round(((classStudents.length - studentsBetter - 1) / classStudents.length) * 100);
  
  // Calculate percentage of students above you
  const studentsAbovePercent = Math.round((studentsBetter / classStudents.length) * 100);
  
  // Calculate what percentile you're in (for ring visualization)
  // Higher value = better rank (used for ring fill percentage)
  let topPercent = 100 - studentsAbovePercent;
  
  // Ensure topPercent is at least 1% (can't be 0% or negative)
  if (topPercent < 1) topPercent = 1;
  
  // Calculate actual top percentile for display (e.g., if 13% are above you, you're "Top 13%")
  // This is the percentage of students who are better than you
  const actualTopPercent = studentsAbovePercent > 0 ? studentsAbovePercent : 1;
  
  console.log(`🔍 [calculateClassPercentile] Debug - studentsAbovePercent: ${studentsAbovePercent}%, topPercent (for ring): ${topPercent}%, actualTopPercent (for display): ${actualTopPercent}%`);
  
  // Determine display, color, and medal based on topPercent (for badge/medal logic)
  // NOTE: We show the ACTUAL top percentile in the display (e.g., "Top 13%" not "Top 87%")
  let display, color, medal;
  if (topPercent >= 90) {
    display = `Top ${actualTopPercent}%`;
    color = '#FFD700'; // Gold
    medal = '🥇'; // Gold medal
  } else if (topPercent >= 75) {
    display = `Top ${actualTopPercent}%`;
    color = '#FFA500'; // Orange
    medal = '🥈'; // Silver medal
  } else if (topPercent >= 50) {
    display = `Top ${actualTopPercent}%`;
    color = '#2f80ed'; // Blue
    medal = '🥉'; // Bronze medal
  } else {
    display = `Top ${actualTopPercent}%`; // Show actual top percentile
    color = '#00C853'; // Green
    medal = '🏅'; // Participation medal
  }
  
  return { percentile, display, color, topPercent, medal };
}

// Helper function to calculate class average completion
function calculateClassAverage(classStudents) {
  if (!classStudents || classStudents.length === 0) {
    return 0;
  }
  
  const total = classStudents.reduce((sum, student) => {
    return sum + ((student.completion || 0) * 100); // Convert to percentage
  }, 0);
  
  return Math.round(total / classStudents.length);
}

// Helper function to calculate overall completion percentage across all quests
function calculateOverallCompletion(user_data, questConfig) {
  // Support both 'completed' and 'accepted' field names for backwards compatibility
  const completionData = user_data?.completed || user_data?.accepted;
  
  if (!user_data || !completionData) {
    return 0;
  }
  
  try {
    let completedTaskCount = 0;
    
    // Count all completed tasks across all quests
    Object.values(completionData).forEach(questData => {
      if (questData && typeof questData === 'object') {
        Object.values(questData).forEach(taskData => {
          if (taskData && taskData.completed === true) {
            completedTaskCount++;
          }
        });
      }
    });
    
    // Calculate total tasks dynamically from quest config if available
    let totalTasksInCourse = 150; // Default fallback
    
    if (questConfig && typeof questConfig === 'object') {
      let calculatedTotal = 0;
      Object.entries(questConfig).forEach(([questId, questData]) => {
        // Skip metadata fields
        if (questId === 'map_repo_link' || !questData || typeof questData !== 'object') {
          return;
        }
        
        // Count tasks in this quest (keys that start with T followed by numbers)
        const taskCount = Object.keys(questData).filter(key => /^T\d+$/i.test(key)).length;
        calculatedTotal += taskCount;
      });
      
      // Only use calculated total if it's reasonable (more than 0)
      if (calculatedTotal > 0) {
        totalTasksInCourse = calculatedTotal;
      }
    }
    
    // Calculate progress as percentage
    const progress = completedTaskCount / totalTasksInCourse;
    
    // Don't cap - students can exceed 100% if they complete extra credit
    return progress;
  } catch (error) {
    console.error('[calculateOverallCompletion] Error:', error);
    return 0;
  }
}

// Helper function to get current quest info
function getCurrentQuestInfo(user_data, questConfig) {
  if (!questConfig || typeof questConfig !== 'object') {
    return {
      questId: 'None',
      questTitlePart1: 'No active quest',
      questTitlePart2: '',
      questTasks: '0/0'
    };
  }
  
  // Get the last quest in the sequence (most advanced quest available)
  const questKeys = Object.keys(questConfig)
    .filter(key => key.startsWith('Q') && questConfig[key] && typeof questConfig[key] === 'object')
    .sort((a, b) => {
      const numA = parseInt(a.substring(1));
      const numB = parseInt(b.substring(1));
      return numA - numB;
    });
  
  if (questKeys.length === 0) {
    return {
      questId: 'None',
      questTitlePart1: 'No active quest',
      questTitlePart2: '',
      questTasks: '0/0'
    };
  }
  
  // Use the last quest in the sequence
  const currentQuest = questKeys[questKeys.length - 1];
  
  // Get quest metadata
  const questData = questConfig[currentQuest];
  const questTitle = questData?.metadata?.title || questData?.title || currentQuest;
  
  // Count completed tasks
  const tasks = Object.keys(questData).filter(k => k !== 'metadata');
  const acceptedTasks = user_data?.accepted?.[currentQuest] || {};
  const completedCount = tasks.filter(taskId => acceptedTasks[taskId]?.completed).length;
  
  // Split quest title for two-line display
  let questTitlePart1 = questTitle;
  let questTitlePart2 = '';
  
  if (questTitle.length > 25) {
    // Find a good break point (space or dash)
    const breakPoint = questTitle.lastIndexOf(' ', 25);
    if (breakPoint > 15) {
      questTitlePart1 = questTitle.substring(0, breakPoint);
      questTitlePart2 = questTitle.substring(breakPoint + 1);
    } else {
      // No good break point, just split at 25 chars
      questTitlePart1 = questTitle.substring(0, 25);
      questTitlePart2 = questTitle.substring(25);
    }
  }
  
  return {
    questId: currentQuest,
    questTitlePart1: questTitlePart1,
    questTitlePart2: questTitlePart2,
    questTasks: `${completedCount}/${tasks.length}`
  };
}

// TODO: do not display on quest 0
async function generateSVG(owner, repo, context, user_data, db, classId = null) {
  try {
    console.log(`🎨 [generateSVG] Starting SVG generation for ${repo}`);
    console.log(`🎨 [generateSVG] classId: ${classId}, user customGroupId: ${user_data?.customGroupId}`);
    
    // Determine if we should use class-aware SVG
    const useClassSVG = classId || user_data?.customGroupId;
    
    if (useClassSVG) {
      console.log(`🎓 [generateSVG] Using CLASS-AWARE SVG template`);
      return await generateClassAwareSVG(owner, repo, context, user_data, db, classId || user_data.customGroupId);
    } else {
      console.log(`👤 [generateSVG] Using INDIVIDUAL SVG template (legacy)`);
      return await generateLegacySVG(owner, repo, context, user_data, db);
    }
  } catch (error) {
    console.error("Error generating SVG:", error);
    return null;
  }
}

// Class-aware SVG generation with class metrics
async function generateClassAwareSVG(owner, repo, context, user_data, db, classId) {
  try {
    console.log(`🎓 [generateClassAwareSVG] Generating class-aware SVG for class: ${classId}`);
    console.log(`🎓 [generateClassAwareSVG] User: ${user_data?.username || user_data?.github || 'unknown'}`);
    console.log(`🎓 [generateClassAwareSVG] Repo: ${owner}/${repo}`);
    
    // Fetch class data (with timeout)
    let classStudents = [];
    try {
      classStudents = await Promise.race([
        fetchClassData(classId, db),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout fetching class data')), 30000)) // Increased to 30 seconds
      ]);
      console.log(`📊 [generateClassAwareSVG] Class has ${classStudents.length} students`);
    } catch (fetchError) {
      console.warn(`⚠️ [generateClassAwareSVG] Could not fetch class data: ${fetchError.message}`);
      console.warn(`⚠️ [generateClassAwareSVG] Attempting local database fallback...`);
      
      // Try local database fallback with longer timeout
      try {
        classStudents = await Promise.race([
          generateClassDataFromLocal(classId, db),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Local fallback timeout')), 30000)) // Increased to 30 seconds
        ]);
        console.log(`📊 [generateClassAwareSVG] Local fallback successful: ${classStudents.length} students`);
      } catch (localError) {
        console.warn(`⚠️ [generateClassAwareSVG] Local fallback failed: ${localError.message}`);
        console.warn(`⚠️ [generateClassAwareSVG] Continuing with empty class data`);
      }
    }
    
    // Get quest config
    const questConfig = await getQuestConfigForUser(user_data);
    
    // Get current quest info
    const questInfo = getCurrentQuestInfo(user_data, questConfig);
    
    // Debug quest info
    console.log(`📊 [generateClassAwareSVG] Quest info:`, questInfo);
    
    // Calculate class metrics using the same logic as the class rank script
    // NOTE: User's progress is ALWAYS LIVE (calculated fresh from current user_data)
    // Class rank uses CACHED class data (30 min TTL) for performance
    // Your Progress shows overall completion across ALL quests (not just current quest)
    const userCompletion = calculateOverallCompletion(user_data, questConfig) * 100;
    const points = Number(user_data?.points || 0);
    const classRank = calculateClassPercentile(userCompletion, classStudents, points);
    
    // Split class rank display for two-line format
    const classRankTop = classRank.display.split(' ')[0]; // "Top"
    const classRankPercent = classRank.display.split(' ')[1]; // "19%"
    
    // Determine performance badge based on topPercent (matches medal logic)
    // Higher topPercent = better performance (Top 90%+ = Gold, Top 75%+ = Silver, etc.)
    let performanceBadge = '';
    if (classRank.topPercent >= 90) {
      performanceBadge = '🥇 Gold Performer';
    } else if (classRank.topPercent >= 75) {
      performanceBadge = '🥈 Silver Performer';
    } else if (classRank.topPercent >= 50) {
      performanceBadge = '🥉 Bronze Performer';
    } else {
      performanceBadge = '👍 Great Performer';
    }
    
    console.log(`📊 [generateClassAwareSVG] User completion: ${userCompletion.toFixed(1)}%`);
    console.log(`📊 [generateClassAwareSVG] Class rank: ${classRank.display}`);
    console.log(`📊 [generateClassAwareSVG] Performance badge: "${performanceBadge}"`);
    console.log(`📊 [generateClassAwareSVG] Class rank object:`, classRank);
    
    // Get class name from management backend
    let className = 'Your Class';
    try {
      const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';
      const axios = (await import('axios')).default;
      // Use base class ID (without _purple_ suffix)
      const baseClassId = classId.split('_')[0];
      const classResponse = await axios.get(`${baseURL}/api/group/${baseClassId}`);
      if (classResponse.data?.success && classResponse.data?.data?.groupName) {
        className = classResponse.data.data.groupName;
        // Truncate if too long
        if (className.length > 35) {
          className = className.substring(0, 32) + '...';
        }
      }
    } catch (err) {
      console.warn(`⚠️ [generateClassAwareSVG] Could not fetch class name: ${err.message}`);
    }
    
    // Basic user stats (points already declared above)
    const xp = Number(user_data?.xp || 0);
    const userProgressPercent = Math.round(userCompletion);
    
    // Count completed quests
    const completedQuests = user_data?.completed && user_data.completed !== undefined
      ? Object.keys(user_data.completed).filter((quest) => {
          const tasks = user_data.completed[quest];
          return tasks && Object.values(tasks).every((task) => task.completed);
        })
      : [];
    const numCompleted = completedQuests.length;
    
    // Get streak data
    const currentStreak = user_data?.currentStreak || 0;
    const streakCount = user_data?.streakCount || 0;
    
    // Stored values count (removed from display)
    const storedValuesCount = user_data?.storedValues ? Object.keys(user_data.storedValues).length : 0;
    let storedValuesSection = '';
    let questCompletedOffset = 112;
    
    // Calculate SVG dimensions
    const baseHeight = 275; // Increased to accommodate Streak section and Badge section
    const viewHeight = baseHeight;
    
    // Circle math for progress dials
    const radius = 40;
    const progressCircumference = 2 * Math.PI * radius;
    const progressOffset = progressCircumference * (1 - userCompletion / 100);
    
    const rankCircumference = 2 * Math.PI * radius;
    // Use topPercent for the ring visualization (represents "Top X%" which is what we display)
    // Ensure topPercent is valid (not 0 or NaN) for ring visibility
    // If topPercent is 0 or invalid, use a small value so ring is still visible
    const safeTopPercent = (classRank.topPercent > 0) ? classRank.topPercent : 1;
    const rankOffset = rankCircumference * (1 - safeTopPercent / 100);
    console.log(`📊 [generateClassAwareSVG] Rank circle: topPercent=${classRank.topPercent}, safeTopPercent=${safeTopPercent}, offset=${rankOffset}, circumference=${rankCircumference}`);
    
    // Streak circle calculation (current streak out of 3)
    const streakCircumference = 2 * Math.PI * radius;
    const streakPercentage = (currentStreak / 3) * 100; // 3 tasks = 1 complete streak
    const streakOffset = streakCircumference * (1 - streakPercentage / 100);
    
    // Determine which sections to show based on quest info
    const showCurrentQuest = questInfo.questId !== 'None' && questInfo.questId !== 'undefined';
    const showQuestTitle = questInfo.questTitlePart1 !== 'No active quest' && questInfo.questTitlePart1 !== 'undefined';
    const showQuestTasks = questInfo.questTasks !== '0/0' && questInfo.questTasks !== 'undefined';
    
    console.log(`📊 [generateClassAwareSVG] Show sections - Quest: ${showCurrentQuest}, Title: ${showQuestTitle}, Tasks: ${showQuestTasks}`);
    
    // Load and populate template
    console.log(`📄 [generateClassAwareSVG] Loading template from: ${classSvgTemplatePath}`);
    console.log(`📄 [generateClassAwareSVG] Template exists: ${fs.existsSync(classSvgTemplatePath)}`);
    
    let svgTemplate = fs.readFileSync(classSvgTemplatePath, "utf-8");
    
    // Conditionally remove sections based on data availability
    if (!showCurrentQuest) {
      // Remove the entire Current Quest section including the label
      svgTemplate = svgTemplate.replace(/<g transform="translate\(0, 0\)">[\s\S]*?Current Quest:[\s\S]*?<\/g>/g, '');
    }
    
    if (!showQuestTitle) {
      // Remove the entire Quest Title section including the label
      svgTemplate = svgTemplate.replace(/<g transform="translate\(0, 25\)">[\s\S]*?Quest Title:[\s\S]*?<\/g>/g, '');
    }
    
    if (!showQuestTasks) {
      // Remove the entire Quest Tasks section including the label
      svgTemplate = svgTemplate.replace(/<g transform="translate\(0, 62\)">[\s\S]*?Quest Tasks:[\s\S]*?<\/g>/g, '');
    }
    
    svgTemplate = svgTemplate
      .replaceAll("${className}", className)
      .replaceAll("${viewHeight}", viewHeight)
      .replaceAll("${userProgressPercent}", Math.round(userCompletion))
      .replaceAll("${progressCircumference}", progressCircumference)
      .replaceAll("${progressOffset}", progressOffset)
      .replaceAll("${classRankTop}", classRankTop)
      .replaceAll("${classRankPercent}", classRankPercent)
      .replaceAll("${rankColor}", classRank.color)
      .replaceAll("${rankCircumference}", rankCircumference)
      .replaceAll("${rankOffset}", rankOffset)
      .replaceAll("${currentStreak}", currentStreak)
      .replaceAll("${streakCount}", streakCount)
      .replaceAll("${streakCircumference}", streakCircumference)
      .replaceAll("${streakOffset}", streakOffset)
      .replaceAll("${currentQuestId}", questInfo.questId)
      .replaceAll("${currentQuestTitle}", questInfo.questTitlePart1)
      .replaceAll("${currentQuestTitleContinuation}", questInfo.questTitlePart2)
      .replaceAll("${currentQuestTasks}", questInfo.questTasks)
      .replaceAll("${points}", points)
      .replaceAll("${performanceBadge}", performanceBadge)
      .replaceAll("${storedValuesSection}", storedValuesSection)
      .replaceAll("${questCompletedOffset}", questCompletedOffset)
      .replaceAll("${numCompleted}", numCompleted)
;
    
    // Generate filename
    const timestamp = Date.now();
    const username = user_data?.username || repo;
    const newFilename = `userCards/${username}-scorecard-${timestamp}.svg`;
    
    console.log(`💾 [generateClassAwareSVG] About to save SVG to: ${newFilename}`);
    console.log(`💾 [generateClassAwareSVG] SVG content length: ${svgTemplate.length} bytes`);
    
    // Save to repo
    const createResult = await context.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: newFilename,
      message: `Update quest progress scorecard`,
      content: Buffer.from(svgTemplate).toString("base64"),
      committer: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      author: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
    });
    
    console.log(`✅ [generateClassAwareSVG] SVG created successfully: ${newFilename}`);
    console.log(`✅ [generateClassAwareSVG] File SHA: ${createResult.data?.content?.sha || 'unknown'}`);
    console.log(`✅ [generateClassAwareSVG] Commit SHA: ${createResult.data?.commit?.sha || 'unknown'}`);
    return newFilename;
    
  } catch (error) {
    console.error("Error generating class-aware SVG:", error);
    console.error(error.stack);
    return null;
  }
}

// Legacy individual SVG generation (fallback for users without class)
async function generateLegacySVG(owner, repo, context, user_data, db) {
  try {
    // Original implementation
    var user_score = 0;
    if (user_data && user_data.points) {
      user_score = await db.downloadUserData(repo);
    }
    const currentPos = user_score && user_score.userPosition ? user_score.userPosition : 0;

    const percentage = (user_data?.completion || 0) * 100;
    const currentStreak = user_data?.currentStreak || 0;
    const streakCount = user_data?.streakCount || 0;

    const radius = 40;
    const rankCircumference = 2 * Math.PI * radius;
    const rankOffset = rankCircumference * (1 - percentage / 100);
    const streakCircumference = 2 * Math.PI * radius;
    const streakOffset = rankCircumference * (1 - currentStreak / 3);

    const numCompleted = user_data?.completed ? Object.keys(user_data.completed).length : 0;
    const points = Number(user_data?.points || 0);
    const level = Math.ceil(points / 100);

    const questSequence = getQuestSequenceForUser(user_data);
    const badgeDescriptions = {};
    questSequence.questSequence.forEach(quest => {
      if (quest.badgeDescription) {
        badgeDescriptions[quest.questId] = quest.badgeDescription;
      }
    });

    const completedQuests = user_data?.completed && user_data.completed !== undefined
        ? Object.keys(user_data.completed).filter((quest) => {
          const tasks = user_data.completed[quest];
          return Object.values(tasks).every((task) => task.completed);
        })
        : [];

    let formattedBadges = "";
    let userScore = "";
    let offset = 75;

    if (user_data?.display_preference && user_data.display_preference.includes("score")) {
      userScore = `
          <g transform="translate(0, ${offset})">
              <g class="stagger" style="animation-delay: 600ms" transform="translate(25, 0)">
                  <text class="stat bold" y="12.5">Total Points✨:</text>
                  <text class="stat bold" x="199.01" y="12.5" data-testid="commits">${points}</text>
              </g>
          </g>
          <g transform="translate(0, ${offset + 25})">
              <g class="stagger" style="animation-delay: 750ms" transform="translate(25, 0)">
                  <text class="stat bold" y="12.5">Current Position:</text>
                  <text class="stat bold" x="199.01" y="12.5" data-testid="prs">${currentPos}</text>
              </g>
          </g>`;
      offset += 50;
    }

    const badgeCount = `
      <g transform="translate(0, ${offset})">
          <g class="stagger" style="animation-delay: 750ms" transform="translate(25, 0)">
              <text class="stat bold" y="12.5">Badges:</text>
              <text class="stat bold" x="199.01" y="12.5" data-testid="prs">${completedQuests.length}</text>
          </g>
      </g>`;
    offset += 25;

    for (let i = 0; i < completedQuests.length; i++) {
      const badge = completedQuests[i];
      formattedBadges += `
            <g transform="translate(0, ${offset})">
                <g class="stagger" style="animation-delay: 750ms" transform="translate(25, 0)">
                    <text class="stat bold" y="12.5">  - ${badgeDescriptions[badge]}</text>
                    <text class="stat bold" x="199.01" y="12.5" data-testid="prs"></text>
                </g>
            </g>`;
      offset += 25;
    }

    const svgTemplate = fs
      .readFileSync(svgTemplatePath, "utf-8")
      .replaceAll("${rankCircumference}", rankCircumference)
      .replaceAll("${rankOffset}", rankOffset)
      .replaceAll("${streakCircumference}", streakCircumference)
      .replaceAll("${streakOffset}", streakOffset)
      .replaceAll("${currentStreak}", currentStreak)
      .replaceAll("${streakCount}", streakCount)
      .replaceAll("${percentage}", percentage)
      .replaceAll("${numCompleted}", numCompleted)
      .replaceAll("${userScore}", userScore)
      .replaceAll("${level}", level)
      .replaceAll("${formattedBadges}", formattedBadges)
      .replaceAll("${badgeCount}", badgeCount)
      .replaceAll("${viewHeight}", 220 + 25 * completedQuests.length);

    const timestamp = Date.now();
    const newFilename = `userCards/draft-${timestamp}.svg`;

    await context.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: newFilename,
      message: `Update ${newFilename}`,
      content: Buffer.from(svgTemplate).toString("base64"),
      committer: {
        name: "gitBot",
        email: "connor.nicolai.aiton@gmail.com",
      },
      author: {
        name: "caiton1",
        email: "connor.nicolai.aiton@gmail.com",
      },
    });

    return newFilename;
  } catch (error) {
    console.error("Error generating legacy SVG:", error);
    return null;
  }
}

// Temp solution to map feature, avoiding github cache TTL
function getMapLink(user_data, quest, task, completed) {
  if (!user_data) {
    return `${mapRepoLink}/Q1.png`; // Return default map link if userData or accepted quests are not available
  }

  // if all quests completed
  if (Object.keys(completed).length === 4) {
    return `${mapRepoLink}/F.png`;
  }
  if (quest === "") {
    // Check if the current quest is completed and find the next available quest
    if (completed !== "" && user_data.accepted != null) {
      const accepted_quests = Object.keys(user_data.accepted);
      const currentQuestIndex = accepted_quests.indexOf(completed);
      const nextQuest =
        currentQuestIndex !== -1 &&
          currentQuestIndex + 1 < accepted_quests.length
          ? accepted_quests[currentQuestIndex + 1]
          : null;

      // Return the map link for the next available quest if exists
      if (nextQuest) {
        return `${mapRepoLink}/${nextQuest}.png`;
      }
    }
    return `${mapRepoLink}/Q1.png`; // Fall through if no next quest is available or no quest is currently set
  }

  const acceptedTasks = user_data.accepted[quest];
  if (!acceptedTasks || Object.keys(acceptedTasks).length === 0) {
    return `${mapRepoLink}/${quest}.png`; // Quest image when no task is started
  }

  const completedTasks = Object.values(acceptedTasks).filter(
    (t) => t.completed
  ).length;
  const totalTasks = Object.keys(acceptedTasks).length;

  if (completedTasks === 0) {
    return `${mapRepoLink}/${quest}T1.png`; // Quest initial map
  } else if (completedTasks === totalTasks) {
    return `${mapRepoLink}/${quest}F.png`; // Quest completed map
  } else {
    return `${mapRepoLink}/${quest}${task}.png`; // Specific task image
  }
}

async function displayQuests(user_data, context) {
  // Get user data
  const repo = context.issue();
  var task = "";
  var quest = "";
  var completed = "";
  var response = ``;

  if (user_data.current != null) {
    task = user_data.current.task;
    quest = user_data.current.quest;
  }

  if (user_data.completed !== undefined) {
    completed = user_data.completed;
  }

  const mapLink = getMapLink(user_data, quest, task, completed);
  const questData = await getQuestConfigForUser(user_data);

  // Show all available quests (both accepted and completed)
  response += `⚙️ Available Quests\n\n`;
  
  // Get all quests from the config (only keys that start with Q)
  const allQuests = Object.keys(questData).filter(key => key.startsWith('Q') && questData[key] && typeof questData[key] === 'object');
  
  for (let questKey of allQuests) {
    // Skip if this quest is completed (it will be shown in completed section)
    if (completed && completed[questKey]) continue;
    
    // Additional safety check
    if (!questData[questKey] || typeof questData[questKey] !== 'object') continue;
    
    // Show quest header
    const questTitle = questData[questKey].metadata?.title || questKey;
    response += `${questKey} - ${questTitle}\n`;
    
    // Show all tasks for this quest
    for (let taskKey in questData[questKey]) {
      if (taskKey === "metadata") continue;
      
      // Safety check for task data
      if (!questData[questKey][taskKey] || typeof questData[questKey][taskKey] !== 'object') continue;
      
      const taskDesc = questData[questKey][taskKey].desc || taskKey;
      const taskState = user_data.accepted?.[questKey]?.[taskKey];
      
      // Check if task is completed
      if (taskState?.completed === true) {
        // Completed task: show with strikethrough and COMPLETED link
        const issueNum = taskState.issueNum;
        if (issueNum && issueNum > 0) {
          response += `  - ~${taskKey} - ${taskDesc}~ [[COMPLETED](https://github.com/${repo.owner}/${repo.repo}/issues/${issueNum})]\n`;
        } else {
          response += `  - ~${taskKey} - ${taskDesc}~ [[COMPLETED]]\n`;
        }
      } else {
        // Check if task has an environment (GitHub issue created)
        const issueNum = taskState?.issueNum;
        
        if (issueNum && issueNum > 0) {
          // Task has stored issue number: show "Click here to start" with direct link
          response += `  - ${taskKey} - ${taskDesc} [[Click here to start](https://github.com/${repo.owner}/${repo.repo}/issues/${issueNum})]\n`;
        } else {
          // No stored issue number - show task without any link
          response += `  - ${taskKey} - ${taskDesc}\n`;
        }
      }
    }
    response += "\n";
  }

  // Show completed quests
  if (completed && Object.keys(completed).length > 0) {
    response += `✅ Completed Quests\n`;
    for (let questKey in completed) {
      // Safety check for quest data
      if (!questData[questKey] || typeof questData[questKey] !== 'object') continue;
      
      const questTitle = questData[questKey].metadata?.title || questKey;
      response += `  - ${questKey} - ${questTitle}\n`;
      for (let taskKey in questData[questKey]) {
        if (taskKey === "metadata") continue;
        
        // Safety check for task data
        if (!questData[questKey][taskKey] || typeof questData[questKey][taskKey] !== 'object') continue;
        
        const taskDesc = questData[questKey][taskKey].desc || taskKey;
        const issueNum = user_data.completed[questKey][taskKey]?.issueNum;
        if (issueNum && issueNum > 0) {
          response += `    - ~${taskKey} - ${taskDesc}~ [[COMPLETED](https://github.com/${repo.owner}/${repo.repo}/issues/${issueNum})]\n`;
        } else {
          response += `    - ~${taskKey} - ${taskDesc}~ [[COMPLETED]]\n`;
        }
      }
    }
  } else {
    response += `✅ Completed Quests\n  - None yet\n`;
  }

  if (user_data.display_preference && user_data.display_preference.includes("map")) {
    response += `\nQuests Map:\n ![Quest Map](${mapLink})`;
  }

  return response;
}

async function updateReadme(owner, repo, context, user_data, db) {
  try {
    console.log(`[updateReadme] Starting README update for ${owner}/${repo}`);
    
    // Check if this repo should get SVG scorecard (enabled for all users with a customGroupId)
    const shouldIncludeSVG = user_data?.customGroupId ? true : false;
    console.log(`[updateReadme] Should include SVG scorecard: ${shouldIncludeSVG}`);
    
    // Generate SVG if applicable
    let newSVG = null;
    if (shouldIncludeSVG) {
      try {
        const classId = user_data?.customGroupId;
        console.log(`[updateReadme] Generating SVG with classId: ${classId}`);
        newSVG = await generateSVG(owner, repo, context, user_data, db, classId);
        console.log(`[updateReadme] Generated SVG: ${newSVG}`);
      } catch (svgError) {
        console.error(`[updateReadme] Error generating SVG: ${svgError.message}`);
        // Continue without SVG if generation fails
      }
    }
    
    // Ensure issue numbers are reconciled so links appear in README
    try {
      const quests = await getQuestConfigForUser(user_data);
      const questKeys = Object.keys(quests)
        .filter(key => key.startsWith('Q') && quests[key] && typeof quests[key] === 'object');
      for (const questKey of questKeys) {
        const orderedTasks = Object.keys(quests[questKey])
          .filter(taskKey => taskKey !== 'metadata')
          .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
        await reconcileIssuesForQuest(user_data, questKey, context, orderedTasks);
      }
    } catch (reconcileError) {
      console.warn(`[updateReadme] ⚠️ Failed to reconcile issues before README update: ${reconcileError.message}`);
    }

    const questList = await displayQuests(user_data, context);
    console.log(`[updateReadme] Generated quest list`);

    // Generate the new dynamic section with timestamp
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Phoenix',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(',', '');
    
    // Build dynamic section with optional SVG
    let dynamicSection = `\n\n---\n\n### 🕒 Progress Update: ${timestamp} MST\n\n`;
    
    // Add SVG scorecard if generated
    if (newSVG) {
      // Use relative path for private repos (GitHub will handle auth automatically)
      // Add timestamp as query param to bust GitHub's aggressive caching
      const cacheBuster = Date.now();
      dynamicSection += `![Quest Progress Scorecard](${newSVG}?v=${cacheBuster})\n\n`;
      console.log(`[updateReadme] Added SVG to dynamic section: ${newSVG}`);
    } else {
      console.log(`[updateReadme] No SVG generated - newSVG is null`);
    }
    
    dynamicSection += questList;
    console.log(`[updateReadme] Generated dynamic section`);

    // Get the original README
//     console.log(`[updateReadme] Fetching current README...`);
    const readmeResponse = await context.octokit.rest.repos.getReadme({
      owner,
      repo,
      path: "README.md",
    });
//     console.log(`[updateReadme] README response received`);

    let originalContent = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
//     console.log(`[updateReadme] Original content length: ${originalContent.length}`);

    // Remove any existing progress sections (everything after the first "---" that contains "Progress Update")
    const progressSectionRegex = /\n\n---\n\n### 🕒 Progress Update:.*$/s;
    let cleanContent = originalContent;
    
    // Keep removing progress sections until none are left
    while (progressSectionRegex.test(cleanContent)) {
      cleanContent = cleanContent.replace(progressSectionRegex, '');
    }
//     console.log(`[updateReadme] Clean content length: ${cleanContent.length}`);

    // Add the new dynamic section
    const newContent = cleanContent + dynamicSection;
//     console.log(`[updateReadme] New content length: ${newContent.length}`);

    // README sha
    const { data: { sha } } = readmeResponse;
    if (!sha) {
      throw new Error("README sha is undefined or null");
    }
//     console.log(`[updateReadme] README SHA: ${sha}`);

    // Update the README file
//     console.log(`[updateReadme] Updating README file...`);
    await context.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "README.md",
      message: "Update README.md with new progress section",
      content: Buffer.from(newContent).toString("base64"),
      committer: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      author: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      sha: sha,
    });
//     console.log(`[updateReadme] README update completed successfully`);
  } catch (error) {
    console.error("Error updating the README: " + error);
    console.error("Error stack: " + error.stack);
  }
}

///////////////////////////////////////////////////
/* ----- Repo/Org administration functions ----- */
///////////////////////////////////////////////////

async function closeIssues(context) {
  const issue = context.payload.issue;

  // Check if the comment contains the command to close all issues
  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  const currentIssueNumber = issue.number;

  // Fetch all issues in the repository
  const issues = await context.octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "open", // Only fetch open issues since closed issues are already closed
  });

  // Iterate through the issues and close them except for the current issue
  for (const issue of issues.data) {
    if (issue.number !== currentIssueNumber) {
      try {
        // Close issue
        await context.octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          state: "closed",
        });
      } catch (error) {
        console.error(`Failed to close issue #${issue.number}:`, error);
      }
    }
  }
}

async function resetReadme(owner, repo, context) {
  var content = fs.readFileSync(defaultReadmePath, "utf-8");

  try {
    const {
      data: { sha },
    } = await context.octokit.rest.repos.getReadme({
      owner,
      repo,
      path: "README.md",
    });
    await context.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "README.md",
      message: "Reseting README.md",
      content: Buffer.from(content).toString("base64"),
      committer: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      author: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      sha: sha,
    });
  } catch (error) {
    console.error("Error reseting the README: " + error);
  }
}

async function createRepos(context, org, users, db) {
  try {
    const response = [];
    for (const user of users) {
      try {
        // Create repo for user
        const repoName = `${user}-oss-doorway`;
        const repoDescription = `OSS Doorway repository for ${user}`;
        
        console.log(`🚀 [OSS-Doorway] Creating repository: ${org}/${repoName}`);
        console.log(`📋 [OSS-Doorway] Quest config: Default quest-sequence.json`);
        
        // Create the repository
        await context.octokit.rest.repos.createInOrg({
          org: org,
          name: repoName,
          description: repoDescription,
          private: false,
          auto_init: true,
          gitignore_template: "Node"
        });

        // Add user as collaborator
        await context.octokit.rest.repos.addCollaborator({
          owner: org,
          repo: repoName,
          username: user,
          permission: "push"
        });

        // Create user in database if they don't exist
        const userExists = await db.createUser(user);
        if (userExists) {
          // Get user data and accept Q0 quest
          const user_document = await db.downloadUserData(user);
          await acceptQuest(context, user_document.user_data, "Q0");
          
          // Save user data immediately after quest acceptance to ensure issueNum is stored
          await db.updateData(user_document);
          
          // Small delay to ensure issue creation is fully processed
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Update README with initial quest progression
          await updateReadme(org, repoName, context, user_document.user_data, db);
          
          // Update user data again after README update
          await db.updateData(user_document);
          
          console.log(`✅ [OSS-Doorway] Repository created: ${org}/${repoName} for user ${user} (Default sequence)`);
          response.push(`✅ Repository created: ${org}/${repoName} for user ${user}`);
        } else {
          console.log(`✅ [OSS-Doorway] Repository created: ${org}/${repoName} for existing user ${user} (Default sequence)`);
          response.push(`⚠️ User ${user} already exists, but repo created: ${org}/${repoName}`);
        }
        
      } catch (error) {
        console.error(`Error creating repo for ${user}:`, error);
        response.push(`❌ Failed to create repo for ${user}: ${error.message}`);
      }
    }
    
    return response.join('\n');
  } catch (error) {
    console.error('Error in createRepos:', error);
    return `❌ Error creating repositories: ${error.message}`;
  }
}

async function createCustomRepos(context, org, users, sequenceFile, db) {
  try {
//     console.log(`Creating custom repos for users: ${users.join(', ')} with sequence: ${sequenceFile}`);
    
    // 1. Validate sequence file exists
    const sequencePath = `./src/config/${sequenceFile}`;
    if (!fs.existsSync(sequencePath)) {
      return `❌ Error: Custom sequence file '${sequenceFile}' not found at ${sequencePath}`;
    }

    // 2. Load custom quest sequence
    let customSequence;
    try {
      customSequence = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
    } catch (error) {
      return `❌ Error: Invalid JSON in sequence file '${sequenceFile}': ${error.message}`;
    }

    // Extract README content if provided in the JSON
    let readmeContent = customSequence.readme || null;
    
    // Generate dynamic quest config with README for non-default sequences
    let dynamicConfig = null;
    if (sequenceFile !== 'quest-sequence.json') {
      // FIXED: Extract class ID from sequence file name for shared configs
      // For class-based configs, use the class ID directly instead of generating unique IDs
      let groupId;
      if (sequenceFile.match(/^68[a-f0-9]{22}\.json$/)) {
        // This is a class ID (MongoDB ObjectId format) - use it directly for shared config
        groupId = sequenceFile.replace('.json', '');
        console.log(`🎓 [OSS-Doorway] Detected class-based config: Using shared groupId ${groupId}`);
      } else {
        // Legacy custom sequence - generate unique ID
        groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🔧 [OSS-Doorway] Generated unique groupId for custom sequence: ${groupId}`);
      }
      
      dynamicConfig = generateCustomQuestConfig(customSequence, groupId);
      
      // Use dynamic README if available, otherwise fall back to static
      if (dynamicConfig.readme) {
        readmeContent = dynamicConfig.readme;
      }
    }
    
    if (readmeContent) {
//       console.log(`📄 README content found in sequence file (${readmeContent.length} characters)`);
    }

    // 3. Validate sequence structure
    if (!customSequence.questSequence || !Array.isArray(customSequence.questSequence)) {
      return `❌ Error: Invalid sequence file structure. Missing or invalid 'questSequence' array.`;
    }

    // 4. Check if this is the default quest-sequence.json
    const isDefaultSequence = sequenceFile === 'quest-sequence.json';
    let groupId = null;
    
    if (!isDefaultSequence) {
      // FIXED: Extract class ID from sequence file name for shared configs
      if (sequenceFile.match(/^68[a-f0-9]{22}\.json$/)) {
        // This is a class ID (MongoDB ObjectId format) - use it directly for shared config
        groupId = sequenceFile.replace('.json', '');
        console.log(`🎓 [OSS-Doorway] Using shared class groupId: ${groupId}`);
      } else {
        // Legacy custom sequence - generate unique ID
        groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🔧 [OSS-Doorway] Generated unique groupId for custom sequence: ${groupId}`);
      }
      
      // Ensure generated directory exists
      const generatedDir = './src/config/generated';
      if (!fs.existsSync(generatedDir)) {
        fs.mkdirSync(generatedDir, { recursive: true });
      }
      
      // Save group-specific config
      const configPath = `${generatedDir}/quest_config_${groupId}.json`;
      fs.writeFileSync(configPath, JSON.stringify(dynamicConfig, null, 2));
      
      // NEW: Also save to database
      try {
        console.log(`💾 [OSS-Doorway] Saving quest config to database for group: ${groupId}`);
        console.log(`📄 [OSS-Doorway] Quest config JSON file: quest_config_${groupId}.json`);
        await ConfigService.saveConfigToDatabase(groupId, dynamicConfig);
        console.log(`✅ [OSS-Doorway] Quest config saved to database: ${groupId}`);
      } catch (dbError) {
        console.error(`❌ [OSS-Doorway] Failed to save quest config to database:`, dbError.message);
        // Don't fail the operation - file system is still working
      }
      
//       console.log(`✅ Generated custom config: ${configPath}`);
    } else {
//       console.log(`✅ Using default quest sequence: ${sequenceFile}`);
    }

    // 5. Create repos with sequence
    const response = [];
    const sequenceId = sequenceFile.replace(/\.json$/i, '');
    for (const user of users) {
      try {
        // Use the same key for both DB and repo, always with -oss-doorway
        const dbUser = `${user}-${sequenceId}-oss-doorway`;
        const repoName = dbUser;
        const repoDescription = `OSS Doorway repository for ${dbUser}`;
        
        console.log(`🚀 [OSS-Doorway] Creating repository: ${org}/${repoName}`);
        if (!isDefaultSequence) {
          console.log(`📋 [OSS-Doorway] Quest config: quest_config_${groupId}.json`);
        }
        
        // Create the repository
        const repoResponse = await context.octokit.rest.repos.createInOrg({
          org: org,
          name: repoName,
          description: repoDescription,
          private: false,
          auto_init: readmeContent ? false : true, // Don't auto-init if we have custom README
          gitignore_template: "Node"
        });

        // Add original user as collaborator
        await context.octokit.rest.repos.addCollaborator({
            owner: org,
          repo: repoName,
          username: user,
          permission: "push"
        });

        // Add README file if provided in the JSON
        if (readmeContent) {
          try {
//             console.log(`📄 Adding custom README file to ${repoName} (${readmeContent.length} characters)`);
            
            // Replace REPO_NAME placeholder with actual repository name
            let finalReadmeContent = readmeContent.replace(/REPO_NAME/g, repoName);
            const base64Content = Buffer.from(finalReadmeContent).toString('base64');
            
            // Wait a moment for repo to be fully initialized
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await context.octokit.rest.repos.createOrUpdateFileContents({
              owner: org,
              repo: repoName,
              path: "README.md",
              message: "Add initial README file from quest sequence",
              content: base64Content,
              branch: "main"
            });
//             console.log(`✅ Custom README file successfully added to ${repoName}`);
            
            // Also add .gitignore since we didn't auto-init
            try {
              const gitignoreContent = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Directory for instrumented libs generated by jscoverage/JSCover
lib-cov

# Coverage directory used by tools like istanbul
coverage/

# nyc test coverage
.nyc_output

# Grunt intermediate storage (http://gruntjs.com/creating-plugins#storing-task-files)
.grunt

# Bower dependency directory (https://bower.io/)
bower_components

# node-modules
node_modules/

# dotenv environment variables file
.env

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless`;
              
              await context.octokit.rest.repos.createOrUpdateFileContents({
                owner: org,
                repo: repoName,
                path: ".gitignore",
                message: "Add Node.js gitignore",
                content: Buffer.from(gitignoreContent).toString('base64'),
                branch: "main"
              });
//               console.log(`✅ .gitignore file added to ${repoName}`);
            } catch (gitignoreError) {
              console.error(`⚠️ Could not add .gitignore to ${repoName}:`, gitignoreError.message);
            }
            
          } catch (readmeError) {
            console.error(`❌ Error adding custom README to ${repoName}:`, readmeError.message);
            console.error(`❌ README Error details:`, readmeError.response?.data || readmeError);
            // Continue with repository creation even if README fails
          }
        } else {
//           console.log(`📄 No custom README provided, repository ${repoName} will use auto-generated README`);
        }

        // Create user in database if they don't exist (using dbUser)
        const userExists = await db.createUser(dbUser);
        // Get user data (either newly created or existing)
        const user_document = await db.downloadUserData(dbUser);
        // COMPLETELY RESET user data for fresh start with new sequence
        user_document.user_data = {
          github: user_document.user_data.github || user,
          username: dbUser,
          points: 0,
          xp: 0,
          completion: 0,
          streakCount: 0,
          currentStreak: 0,
          completed: {},
          accepted: {},
          current: null,
          customGroupId: null,
          customSequenceFile: null
        };
        // Set custom group ID for non-default sequences
        if (!isDefaultSequence) {
          user_document.user_data.customGroupId = groupId;
          user_document.user_data.customSequenceFile = sequenceFile;
        }
        // Find the first quest (no prerequisite or isQ0)
        let firstQuest;
        if (isDefaultSequence) {
          const defaultQuestConfig = getQuestConfig();
          if (defaultQuestConfig.Q0) {
            firstQuest = { questId: "Q0" };
          } else {
            const defaultQuests = Object.keys(defaultQuestConfig).filter(key => key !== "map_repo_link");
            if (defaultQuests.length > 0) {
              firstQuest = { questId: defaultQuests[0] };
            }
          }
        } else {
          firstQuest = customSequence.questSequence.find(q => 
            !q.metadata.prerequisite || q.metadata.isQ0
          );
        }
        // Create a new context object for the new repo
        const newRepoContext = {
          ...context,
          repo: () => ({ owner: org, repo: repoName }),
          issue: (obj = {}) => ({ owner: org, repo: repoName, ...obj })
        };
        // Initialize quest content for the new repository (for both new and existing users)
        if (firstQuest) {
          await acceptQuest(newRepoContext, user_document.user_data, firstQuest.questId);
          // Save user data immediately after quest acceptance to ensure issueNum is stored
          await db.updateData(user_document);
          // Small delay to ensure issue creation is fully processed
          await new Promise(resolve => setTimeout(resolve, 500));
          // Update README with initial quest progression
          await updateReadme(org, repoName, newRepoContext, user_document.user_data, db);
        } else if (customSequence.questSequence.length > 0) {
          await acceptQuest(newRepoContext, user_document.user_data, customSequence.questSequence[0].questId);
          // Save user data immediately after quest acceptance to ensure issueNum is stored
          await db.updateData(user_document);
          // Small delay to ensure issue creation is fully processed
          await new Promise(resolve => setTimeout(resolve, 500));
          // Update README with initial quest progression
          await updateReadme(org, repoName, newRepoContext, user_document.user_data, db);
        } else {
          console.warn(`No quests found to initialize for user ${dbUser} in sequence ${sequenceFile}`);
        }
        // Update user data
        await db.updateData(user_document);
        
        // Log repository creation with quest config info
        if (!isDefaultSequence) {
          console.log(`✅ [OSS-Doorway] Repository created: ${org}/${repoName} for user ${dbUser} (Group: ${groupId})`);
          console.log(`📋 [OSS-Doorway] Quest config: quest_config_${groupId}.json`);
        } else {
          console.log(`✅ [OSS-Doorway] Repository created: ${org}/${repoName} for user ${dbUser} (Default sequence)`);
        }
        
        if (userExists) {
          response.push(`✅ Repository created: ${org}/${repoName} for user ${dbUser}${!isDefaultSequence ? ` (Group: ${groupId})` : ''}`);
        } else {
          response.push(`✅ Repository created and initialized: ${org}/${repoName} for existing user ${dbUser}${!isDefaultSequence ? ` (Group: ${groupId})` : ''}`);
        }
      } catch (error) {
        console.error(`Error creating repo for ${user}:`, error);
        response.push(`❌ Failed to create repo for ${user}: ${error.message}`);
      }
    }
    
    return response.join('\n');
    } catch (error) {
    console.error('Error in createCustomRepos:', error);
    return `❌ Error creating repositories: ${error.message}`;
  }
}

function generateCustomQuestConfig(customSequence, groupId) {
  // Convert to legacy format that the system expects
  const legacyConfig = {
    map_repo_link: customSequence.map_repo_link || process.env.OSS_REPO
  };
  
  // Generate dynamic initial README content with quest progression
  let dynamicReadme = customSequence.readme || "# Welcome to Your Quest!\n\nThis repository contains your personalized learning journey.\n\n## Getting Started\n\n1. Check the issues tab for your first quest\n2. Complete tasks in order\n3. Use comments to submit your answers\n\nGood luck! 🚀";
  
  // Add quest progression section
  dynamicReadme += "\n\n---\n\n### 🕒 Progress Update\n\n";
  
  // Find the first quest (no prerequisite or isQ0)
  const firstQuest = customSequence.questSequence.find(q => 
    !q.metadata.prerequisite || q.metadata.isQ0
  );
  
  if (firstQuest) {
    dynamicReadme += `⚙️ Current Quest\n  - ${firstQuest.questId} - ${firstQuest.metadata.title}\n`;
    
    // Add all tasks for the first quest
    Object.entries(firstQuest.tasks).forEach(([taskKey, taskData]) => {
      if (taskKey === "metadata") return;
      
      if (taskKey === "T1") {
        // First task gets a clickable link to issue #1
        // Note: REPO_NAME will be replaced with actual repo name when used
        dynamicReadme += `    - ${taskKey} - ${taskData.desc} [[Click here to start](https://github.com/OSS-Doorway-Dev/REPO_NAME/issues/1)]\n`;
      } else {
        // Other tasks just show description
        dynamicReadme += `    - ${taskKey} - ${taskData.desc}\n`;
      }
    });
    
    dynamicReadme += "\n✅ Completed Quests\n  - None yet\n";
  }
  
  // Store the dynamic README in the legacy config
  legacyConfig.readme = dynamicReadme;
  
  // Convert each quest from sequence format to legacy format
  customSequence.questSequence.forEach(quest => {
    const questId = quest.questId;
    
    // Process tasks to ensure quiz tasks have proper accept field
    const processedTasks = {};
    Object.entries(quest.tasks).forEach(([taskId, taskData]) => {
      // If this is a quiz task, ensure the accept field contains the questions
      if (taskData.type === 'quiz' && taskData.questions && Array.isArray(taskData.questions)) {
        const processedTask = { ...taskData };
        
        // Build the complete quiz content for the accept field
        let quizContent = `### 🧠 Quiz\n\n`;
        quizContent += `Quest: ${quest.metadata?.title || quest.title}\n\n`;
        quizContent += `Description: ${quest.metadata?.description || ''}\n\n`;
        quizContent += `Instructions: Answer all questions and submit your answers in the format [a,b,c,d,e] where each letter corresponds to your answer for each question.\n\n`;
        quizContent += `Example: If you think the answers are A, C, B, D, E, type: [a,c,b,d,e]\n\n`;
        
        taskData.questions.forEach((question, index) => {
          if (question.question) {
            quizContent += `Question ${index + 1}: ${question.question}\n\n`;
            if (question.optionA) quizContent += `A) ${question.optionA}\n`;
            if (question.optionB) quizContent += `B) ${question.optionB}\n`;
            if (question.optionC) quizContent += `C) ${question.optionC}\n`;
            if (question.optionD) quizContent += `D) ${question.optionD}\n`;
            quizContent += `\n`;
          }
        });
        
        quizContent += `Submit your answers in the format [a,b,c,d,e] where each letter is your answer choice.`;
        processedTask.accept = quizContent;
        
        // CRITICAL: Ensure questions array structure is preserved for validation
        console.log(`🧠 [BOT-QUEST-LOAD] Processed quiz task ${questId}.${taskId} with ${processedTask.questions.length} questions`);
        console.log(`🧠 [BOT-QUEST-LOAD] Questions structure preserved for validation`);
        
        processedTasks[taskId] = processedTask;
      } else {
        // Preserve detailedHints if they exist
        if (taskData.detailedHints) {
          processedTasks[taskId] = { ...taskData };
        } else {
          processedTasks[taskId] = taskData;
        }
      }
    });
    
    // Create quest object in legacy format
    legacyConfig[questId] = {
      metadata: quest.metadata,
      ...processedTasks
    };
  });
  
  return legacyConfig;
}

async function deleteRepo(context, org, repo) {
  try {
    // Deletes a repository in the specified organization
    await context.octokit.rest.repos.delete({
      owner: org,
      repo: repo
    });
    return `Repository ${repo} deleted successfully in organization ${org}`
  } catch (error) {
    return `Error deleting repository: ${error}`;
  }
}

// Function to build dynamic task mapping based on user's quest config
function buildDynamicTaskMapping(userQuestConfig) {
  const dynamicTaskMapping = {};

  // Dynamically build task mapping based on quest configuration
  for (const [questId, questData] of Object.entries(userQuestConfig)) {
    // Skip non-quest properties like map_repo_link
    if (questId === "map_repo_link" || typeof questData !== "object") {
      continue;
    }
    
    // Initialize quest mapping even if it exists in static taskMapping
    // This allows dynamic handlers to override static ones for specific task types
    dynamicTaskMapping[questId] = {};
    
    // Check if this quest has static handlers
    const hasStaticHandlers = taskMapping[questId];
    if (hasStaticHandlers) {
//       console.log(`Quest ${questId} has static handlers, but will allow dynamic overrides for specific task types`);
    }
    
    // Get quest title from metadata for title-based mapping
    // Check questTitle first (preserved from questSequence format), then metadata.title, then questData.title
    const questTitle = questData.metadata?.questTitle || questData.metadata?.title || questData.title;
    console.log(`🔍 [buildDynamicTaskMapping] Quest ${questId} title resolution: questTitle="${questData.metadata?.questTitle}", metadata.title="${questData.metadata?.title}", questData.title="${questData.title}" → final="${questTitle}"`);
    
    dynamicTaskMapping[questId] = {};
    
    for (const [taskId, taskData] of Object.entries(questData)) {
      if (taskId === "metadata") continue;
      
      // Debug logging for task type identification
//       console.log(`[buildDynamicTaskMapping] Processing ${questId}.${taskId}, type: ${taskData.type}`);
      
      // Determine handler based on task type
      switch (taskData.type) {
        case "multiple-choice":
        case "mcq":
//           console.log(`[buildDynamicTaskMapping] Creating MCQ handler for ${questId}.${taskId}`);
          // Use generic MCQ handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleMCQ(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
        
        case "truefalse":
          // Use generic True/False handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleTrueFalse(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
        
        case "custom":
          // Use generic custom handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleCustom(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "get-issue-count":
          // Use generic issue count handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleIssueCount(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "get-pr-count":
          // Use generic PR count handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handlePRCount(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "get-top-contributor":
          // Use generic top contributor handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleTopContributor(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "get-issue-title":
          // Use generic issue title handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleIssueTitle(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "get-open-issue":
          // Use generic open issues handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleOpenIssues(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "quiz":
          // Use generic quiz handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleQuest(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "assigned":
          // Use generic assignment validation handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleAssigned(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "issue-no":
          // Use generic issue number handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleIssueNo(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "custom-api-call":
          // Use generic custom API call handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleCustomAPICall(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "llm-text-validation":
          // Use generic LLM text validation handler
//           console.log(`[buildDynamicTaskMapping] Creating LLM text validation handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleLLMTextValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
        
        case "imageValidation":
          // Use generic image validation handler
//           console.log(`[buildDynamicTaskMapping] Creating image validation handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleImageValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "github-api":
          // Handle different GitHub API call types
          if (taskData.apiCallType === 'issue-count') {
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleIssueCount(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          } else if (taskData.apiCallType === 'pr-count') {
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handlePRCount(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          } else if (taskData.apiCallType === 'top-contributor') {
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleTopContributor(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          } else if (taskData.apiCallType === 'issue-title') {
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleIssueTitle(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          } else if (taskData.apiCallType === 'open-issues') {
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleOpenIssues(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          } else {
            // Fallback to custom handler for other API call types
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleCustom(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          }
          break;
          
        case "comment":
          // Use generic comment handler
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleComment(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "collect-info":
          // Use generic collect-info handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating collect-info handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleCollectInfo(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-fork-url":
          // Use generic fork URL validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-fork-url handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleForkUrlValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-file-exists":
          // Use generic file exists validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-file-exists handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleFileExistsValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-file-content":
          // Use generic file content validation handler (LLM-based)
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-file-content handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleFileContentValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-pr-url":
          // Use generic PR URL validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-pr-url handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handlePRUrlValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
        case "validate-push":
          // Use generic push/commit validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-push handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handlePushValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
        
        case "iterative-code-review":
          // Use generic iterative code review handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating iterative-code-review handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleIterativeCodeReview(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "bot-code-review":
          // Use generic bot code review handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating bot-code-review handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleBotCodeReview(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-github-actions":
          // Use GitHub Actions workflow validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-github-actions handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleGitHubActionsValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "validate-repository":
          // Use repository validation handler
          console.log(`🔧 [buildDynamicTaskMapping] Creating validate-repository handler for ${questId}.${taskId}`);
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleRepositoryValidation(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          break;
          
        case "general":
          // For "general" type, map quest titles to legacy quest handlers
          // This allows legacy quests (Q1, Q2, Q3) to be identified by title instead of questId
          
          // Map quest titles to legacy quest IDs
          const titleToLegacyQuestId = {
            "Understanding OSS Projects and GitHub Basics": "Q1",
            "Forking and Contributing to Repositories": "Q2",
            "Creating Pull Requests and Code Reviews": "Q3"
          };
          
          // Try to find legacy quest ID by title
          const legacyQuestId = titleToLegacyQuestId[questTitle];
          console.log(`🔍 [buildDynamicTaskMapping] General task ${questId}.${taskId}: questTitle="${questTitle}", legacyQuestId=${legacyQuestId || 'NOT FOUND'}, hasHandler=${legacyQuestId && taskMapping[legacyQuestId]?.[taskId] ? 'YES' : 'NO'}`);
          
          // PRIORITY 1: If title matches a legacy quest, use that quest's handlers (title-based mapping)
          if (legacyQuestId && taskMapping[legacyQuestId]?.[taskId]) {
            console.log(`🔧 [buildDynamicTaskMapping] ✅ Mapping quest "${questTitle}" (${questId}) to legacy ${legacyQuestId}.${taskId} handler`);
            // Wrap the legacy handler to pass the actual quest/task IDs
            const legacyHandler = taskMapping[legacyQuestId][taskId];
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              legacyHandler(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          }
          // PRIORITY 2: Check if there's a static handler for the current questId
          else if (taskMapping[questId]?.[taskId]) {
            console.log(`🔧 [buildDynamicTaskMapping] Using static handler for ${questId}.${taskId}`);
            dynamicTaskMapping[questId][taskId] = taskMapping[questId][taskId];
          } 
          // PRIORITY 3: No static handler found, fallback to MCQ handler
          else {
            console.log(`🔧 [buildDynamicTaskMapping] No static handler for ${questId}.${taskId} (title: "${questTitle}"), using MCQ fallback`);
            dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
              handleMCQ(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
          }
          break;
          
        default:
          // Fallback to MCQ handler for unknown types
          dynamicTaskMapping[questId][taskId] = (user_data, user, context, ossRepo, response, selectedIssue, db) => 
            handleMCQ(user_data, user, context, ossRepo, response, selectedIssue, db, questId, taskId);
      }
    }
  }
  
  return dynamicTaskMapping;
}

// Function to get original class name from OSS-Management database
async function getOriginalClassName(groupId) {
  try {
    if (!groupId) {
//       console.log('[getOriginalClassName] No groupId provided, using fallback');
      return null;
    }

    // For now, return null to avoid mongoose require issues
    // TODO: Implement proper database connection if needed
//     console.log(`[getOriginalClassName] Skipping database lookup for groupId: ${groupId}`);
    return null;
  } catch (error) {
    console.error(`[getOriginalClassName] Error fetching original class name:`, error);
    return null;
  }
}

// (Removed markdown sanitization to allow native GitHub markdown rendering)

async function markAsCompleted(context, org, db) {
  try {
    const { owner, repo } = context.repo();
    const issueNumber = context.issue().issue_number;
    
//     console.log(`🎯 [markAsCompleted] Processing issue #${issueNumber} in ${owner}/${repo}`);
    
    // Get the username from the comment author (who is using the command)
    const username = context.payload.comment.user.login;
//     console.log(`🎯 [markAsCompleted] Comment author username: ${username}`);
    
    // Check if the comment author has admin access (repository owner, org member, or repo collaborator)
//     console.log(`🎯 [markAsCompleted] Comment author: ${username}, Repository owner: ${owner}`);
    
    // Import the isAdmin function from the main index.js
    // Since we can't import it directly, we'll use a different approach
    // Check if user is the exact owner OR if they have admin/write access to the repo
    let hasAccess = false;
    
    // Check 1: Exact owner match
    if (username === owner) {
      hasAccess = true;
//       console.log(`🎯 [markAsCompleted] Permission check passed - ${username} is the exact repository owner`);
    } else {
      // Check 2: User has admin/write access to the repository
      try {
        const repoAccess = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
          owner,
          repo,
          username
        });
        
        if (repoAccess && repoAccess.data && 
            ['admin', 'write', 'maintain'].includes(repoAccess.data.permission)) {
          hasAccess = true;
//           console.log(`🎯 [markAsCompleted] Permission check passed - ${username} has ${repoAccess.data.permission} access`);
        }
      } catch (error) {
//         console.log(`🎯 [markAsCompleted] Could not check repo permissions: ${error.message}`);
      }
    }
    
    if (!hasAccess) {
      return `❌ **Permission Denied!** Only repository owners, organization members with admin/write access, or repository collaborators can use the /markascompleted command.`;
    }
    
    // Find the user in the database using the repository name
    // The database key is typically the first part of the repository name (e.g., MisanatNAU for MisanatNAU-{}classname)
    // Extract the username from the repository name (everything before the first hyphen)
    const repoName = repo.split('-')[0];
//     console.log(`🎯 [markAsCompleted] Repository: ${repo}, Extracted username: ${repoName}`);
    
    let userDocument = null;
    
    try {
      userDocument = await db.downloadUserData(repoName);
//       console.log(`🎯 [markAsCompleted] Found user with repository key: ${repoName}`);
    } catch (error) {
//       console.log(`🎯 [markAsCompleted] User ${repoName} not found, trying alternative patterns...`);
      
      // Try alternative database key patterns
      const alternativeKeys = [
        repoName, // First try the extracted username
        `${repoName}-oss-doorway`,
        `${repoName}-oss`,
        `${repoName}-doorway`,
        repo, // Try the full repository name
        `${repo}-oss-doorway`,
        `${repo}-oss`,
        `${repo}-doorway`
      ];
      
//       console.log(`🎯 [markAsCompleted] Trying alternative database keys:`, alternativeKeys);
      
      for (const key of alternativeKeys) {
        try {
//           console.log(`🎯 [markAsCompleted] Trying key: ${key}`);
          userDocument = await db.downloadUserData(key);
          if (userDocument) {
//             console.log(`🎯 [markAsCompleted] Found user with key: ${key}`);
            break;
          }
        } catch (e) {
//           console.log(`🎯 [markAsCompleted] Key ${key} not found: ${e.message}`);
          // Continue to next alternative
        }
      }
    }
    
    if (!userDocument) {
      return `❌ User ${repoName} not found in database. Please ensure you have accepted a quest first.\n\n` +
             `**Tried database keys:**\n` +
             `- ${repoName} (extracted from ${repo})\n` +
             `- ${repoName}-oss-doorway\n` +
             `- ${repoName}-oss\n` +
             `- ${repoName}-doorway\n` +
             `- ${repo} (full repository name)\n` +
             `- ${repo}-oss-doorway\n` +
             `- ${repo}-oss\n` +
             `- ${repo}-doorway\n\n` +
             `**To fix this:**\n` +
             `1. Make sure you've accepted a quest first\n` +
             `2. Check that your repository name matches the expected pattern\n` +
             `3. The system is looking for a user with username: ${repoName}`;
    }
    
//     console.log(`🎯 [markAsCompleted] Found user: ${repoName}`);
    
    // Check if user has a current quest and task
    if (!userDocument.user_data.current || !userDocument.user_data.current.quest || !userDocument.user_data.current.task) {
      return `❌ No active quest/task found for ${repoName}. Please accept a quest first.`;
    }
    
    const currentQuest = userDocument.user_data.current.quest;
    const currentTask = userDocument.user_data.current.task;
    
//     console.log(`🎯 [markAsCompleted] Current quest: ${currentQuest}, task: ${currentTask}`);
    
    // Get quest configuration to determine points and XP
    const questConfig = await getQuestConfigForUser(userDocument.user_data);
    
    if (!questConfig[currentQuest] || !questConfig[currentQuest][currentTask]) {
      return `❌ Quest configuration not found for ${currentQuest}.${currentTask}`;
    }
    
    const taskConfig = questConfig[currentQuest][currentTask];
    const points = taskConfig.points || 10; // Default points if not specified
    const xp = taskConfig.xp || 5; // Default XP if not specified
    
//     console.log(`🎯 [markAsCompleted] Awarding ${points} points and ${xp} XP`);
    
    // Mark task as completed
    if (userDocument.user_data.accepted && userDocument.user_data.accepted[currentQuest] && userDocument.user_data.accepted[currentQuest][currentTask]) {
      userDocument.user_data.accepted[currentQuest][currentTask].completed = true;
      userDocument.user_data.accepted[currentQuest][currentTask].timeEnd = Date.now();
      userDocument.user_data.accepted[currentQuest][currentTask].issueNum = issueNumber;
      
      // Award points and XP
      userDocument.user_data.points += points;
      userDocument.user_data.xp += xp;
      
      // Update completion percentage
      userDocument.user_data.completion = calculateOverallCompletion(userDocument.user_data, questConfig);
      
//       console.log(`🎯 [markAsCompleted] Task marked as completed. New points: ${userDocument.user_data.points}, completion: ${userDocument.user_data.completion}`);
      
      // Check if this was the last task in the quest
      if (taskIndex === tasks.length - 1) {
//         console.log(`🎯 [markAsCompleted] Last task completed, completing quest ${currentQuest}`);
        await completeQuest(userDocument.user_data, currentQuest, context);
        // completeQuest -> acceptQuest sets current to next quest; don't overwrite it
        if (!userDocument.user_data.current) {
          console.log(`🎯 [markAsCompleted] All quests complete, no next quest`);
        }
      } else {
        // Move to next task and maintain task buffer
        const nextTask = tasks[taskIndex + 1];
        userDocument.user_data.current.task = nextTask;
//         console.log(`🎯 [markAscompleted] Moving to next task: ${nextTask}`);
        
        // Maintain task buffer according to sliding window logic
        if (isEnhancedQuestSystemEnabled()) {
          try {
            await maintainTaskBuffer(userDocument.user_data, currentQuest, context, questConfig[currentQuest]);
            console.log(`🎯 [markAsCompleted] Task buffer maintained for ${currentQuest}`);
          } catch (bufferError) {
            console.error(`⚠️ [markAsCompleted] Failed to maintain task buffer:`, bufferError.message);
            // Fallback: create environment for next task
            try {
              await createQuestEnvironment(userDocument.user_data, currentQuest, nextTask, context);
              console.log(`🎯 [markAsCompleted] Fallback: Created environment for next task: ${currentQuest}.${nextTask}`);
            } catch (envError) {
              console.error(`⚠️ [markAsCompleted] Failed to create next task environment:`, envError.message);
            }
          }
        }
      }
      
      // Close the issue
      await context.octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed"
      });
      
      // Update README (with error handling)
      try {
        await updateReadme(owner, repo, context, userDocument.user_data, db);
//         console.log(`🎯 [markAsCompleted] README updated successfully`);
      } catch (readmeError) {
        console.error(`⚠️ [markAsCompleted] README update failed:`, readmeError.message);
        // Continue execution even if README update fails
      }
      
      // Save user data
      await db.updateData(userDocument);
      
      return `🎉 **Task Completed Successfully!**\n\n` +
             `✅ **${currentQuest}.${currentTask}** marked as completed for **${repoName}**\n` +
             `💰 **Points earned:** ${points}\n` +
             `⭐ **XP earned:** ${xp}\n` +
             `📊 **Total points:** ${userDocument.user_data.points}\n` +
             `📈 **Completion rate:** ${Math.round(userDocument.user_data.completion * 100)}%\n\n` +
             `This issue has been automatically closed.`;
      
    } else {
      return `❌ Task ${currentQuest}.${currentTask} not found in user's accepted quests.`;
    }
    
  } catch (error) {
    console.error('❌ Error in markAsCompleted:', error);
    return `❌ Error marking task as completed: ${error.message}`;
  }
}

async function bypassSpecificTask(user_data, taskId, context, db) {
  try {
    const { owner, repo } = context.repo();
    const repoName = repo;
    
    console.log(`🔓 [bypassSpecificTask] Bypassing task ${taskId} for ${repoName}`);
    
    // Get quest configuration for user
    let questConfig;
    try {
      questConfig = await getQuestConfigForUser(user_data);
    } catch (error) {
      console.error(`[bypassSpecificTask] Failed to load quest config: ${error.message}`);
      return `❌ Error: Could not load quest configuration. This may be due to a missing or corrupted configuration file. Please contact an administrator.`;
    }
    
    // Parse task ID (e.g., "Q1T1" -> quest="Q1", task="T1")
    const questMatch = taskId.match(/^(Q\d+)(.*)$/);
    if (!questMatch) {
      return `❌ Invalid task ID format: ${taskId}. Use format like Q1T1, Q2T3, etc.`;
    }
    
    const questId = questMatch[1];
    const taskPart = questMatch[2];
    
    // Find the exact task ID in the quest
    if (!questConfig[questId]) {
      return `❌ Quest ${questId} not found in configuration.`;
    }
    
    const questTasks = Object.keys(questConfig[questId]).filter(t => t !== "metadata");
    const targetTask = questTasks.find(t => t.includes(taskPart) || t === taskId || t === taskPart);
    
    if (!targetTask) {
      return `❌ Task ${taskId} not found in quest ${questId}. Available tasks: ${questTasks.join(', ')}`;
    }
    
    // Check if this is the current active task
    if (!user_data.current || !user_data.current.quest || !user_data.current.task) {
      return `❌ No active quest or task found. Please start a quest first.`;
    }
    
    if (user_data.current.quest !== questId) {
      return `❌ Cannot bypass task ${taskId}. You are currently on quest ${user_data.current.quest}. Only bypass the current active quest.`;
    }
    
    if (user_data.current.task !== targetTask) {
      return `❌ Cannot bypass task ${taskId}. You are currently on task ${user_data.current.task}. Only bypass the current active task.`;
    }
    
    const taskConfig = questConfig[questId][targetTask];
    const points = taskConfig.points || 10;
    const xp = taskConfig.xp || 5;
    
    // Ensure quest is accepted
    if (!user_data.accepted) user_data.accepted = {};
    if (!user_data.accepted[questId]) {
      await acceptQuest(context, user_data, questId);
    }
    
    // Ensure task is accepted
    if (!user_data.accepted[questId][targetTask]) {
      user_data.accepted[questId][targetTask] = {
        accepted: true,
        timeStart: Date.now(),
        completed: false,
        hintsUsed: []
      };
    }
    
    // Mark task as completed with bypass flag
    user_data.accepted[questId][targetTask].completed = true;
    user_data.accepted[questId][targetTask].timeEnd = Date.now();
    user_data.accepted[questId][targetTask].bypassed = true;
    user_data.accepted[questId][targetTask].bypassedBy = context.payload.comment.user.login;
    user_data.accepted[questId][targetTask].bypassedAt = Date.now();
    
    // Award full points (no hint penalties)
    user_data.points += points;
    user_data.xp += xp;
    
    // Update completion percentage
    const allTasks = Object.keys(questConfig[questId]).filter(t => t !== "metadata");
    const completedTasks = allTasks.filter(t => 
      user_data.accepted[questId][t] && user_data.accepted[questId][t].completed
    );
    user_data.completion = completedTasks.length / allTasks.length;
    user_data.completion = Math.round(user_data.completion * 100) / 100;
    
    // Check if quest is now complete
    if (completedTasks.length === allTasks.length) {
      await completeQuest(user_data, questId, context);
      // completeQuest -> acceptQuest sets current to next quest; don't overwrite it
      if (!user_data.current) {
        console.log(`🔓 [bypassSpecificTask] All quests complete, no next quest`);
      }
    } else {
      // Find next uncompleted task - check both accepted and completed objects
      const nextTask = allTasks.find(t => {
        // Check if task is completed in the completed object
        const isCompletedInCompleted = user_data.completed && 
          user_data.completed[questId] && 
          user_data.completed[questId][t] && 
          user_data.completed[questId][t].completed;
        
        // Check if task is completed in the accepted object
        const isCompletedInAccepted = user_data.accepted[questId][t] && 
          user_data.accepted[questId][t].completed;
        
        // Task is uncompleted if it's not completed in either object
        return !isCompletedInCompleted && !isCompletedInAccepted;
      });
      
      if (nextTask && user_data.current) {
        user_data.current.task = nextTask;
      }
    }
    
    // Close the current issue
    try {
      const issueNumber = context.issue().issue_number;
      await context.octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed"
      });
      console.log(`🔓 [bypassSpecificTask] Issue #${issueNumber} closed for ${repoName}`);
    } catch (closeError) {
      console.error(`⚠️ [bypassSpecificTask] Failed to close issue:`, closeError.message);
    }
    
    // Maintain task buffer according to sliding window logic
    if (isEnhancedQuestSystemEnabled() && user_data.current) {
      try {
        await maintainTaskBuffer(user_data, user_data.current.quest, context, questConfig[user_data.current.quest]);
        console.log(`🔓 [bypassSpecificTask] Task buffer maintained for ${user_data.current.quest}`);
      } catch (bufferError) {
        console.error(`⚠️ [bypassSpecificTask] Failed to maintain task buffer:`, bufferError.message);
        // Fallback: create environment for next task if available
        if (user_data.current && user_data.current.task) {
          try {
            await createQuestEnvironment(user_data, user_data.current.quest, user_data.current.task, context);
            console.log(`🔓 [bypassSpecificTask] Fallback: Created environment for next task: ${user_data.current.quest}.${user_data.current.task}`);
          } catch (envError) {
            console.error(`⚠️ [bypassSpecificTask] Failed to create next task environment:`, envError.message);
          }
        }
      }
    } else if (user_data.current && user_data.current.task) {
      // Legacy behavior: Create environment for next task if available
      try {
        await createQuestEnvironment(user_data, user_data.current.quest, user_data.current.task, context);
        console.log(`🔓 [bypassSpecificTask] Created environment for next task: ${user_data.current.quest}.${user_data.current.task}`);
      } catch (envError) {
        console.error(`⚠️ [bypassSpecificTask] Failed to create next task environment:`, envError.message);
      }
    }
    
    // Update README
    try {
      await updateReadme(owner, repo, context, user_data, db);
    } catch (readmeError) {
      console.error(`⚠️ [bypassSpecificTask] README update failed:`, readmeError.message);
    }
    
    return `**Task Bypassed Successfully!**\n\n` +
           `**${questId}.${targetTask}** bypassed for **${repoName}**\n` +
           `**Points awarded:** ${points}\n\n` +
           `**Status:** Bypassed by class admin\n` +
           `**Next task:** ${user_data.current && user_data.current.task ? `${user_data.current.quest}.${user_data.current.task}` : 'All tasks completed!'}`;
    
  } catch (error) {
    console.error('❌ Error in bypassSpecificTask:', error);
    return `❌ Error bypassing task: ${error.message}`;
  }
}

async function bypassAllTasks(user_data, context, db) {
  try {
    const { owner, repo } = context.repo();
    const repoName = repo;
    
    console.log(`🔓 [bypassAllTasks] Bypassing all tasks for ${repoName}`);
    
    // Check if there's a current active quest
    if (!user_data.current || !user_data.current.quest) {
      return `❌ No active quest found. Please start a quest first.`;
    }
    
    const currentQuestId = user_data.current.quest;
    
    // Get quest configuration for user
    let questConfig;
    try {
      questConfig = await getQuestConfigForUser(user_data);
    } catch (error) {
      console.error(`[bypassAllTasks] Failed to load quest config: ${error.message}`);
      return `❌ Error: Could not load quest configuration. This may be due to a missing or corrupted configuration file. Please contact an administrator.`;
    }
    
    // Only bypass tasks in the current active quest
    if (!questConfig[currentQuestId]) {
      return `❌ Current quest ${currentQuestId} not found in configuration.`;
    }
    
    let totalPoints = 0;
    let totalXP = 0;
    let tasksCount = 0;
    
    // Ensure accepted quests structure exists
    if (!user_data.accepted) user_data.accepted = {};
    
    // Only work with the current active quest
    const questId = currentQuestId;
    
    // Accept quest if not already accepted
    if (!user_data.accepted[questId]) {
      await acceptQuest(context, user_data, questId);
    }
    
    const questTasks = Object.keys(questConfig[questId]).filter(t => t !== "metadata");
    
    for (const taskId of questTasks) {
      const taskConfig = questConfig[questId][taskId];
      const points = taskConfig.points || 10;
      const xp = taskConfig.xp || 5;
      
      // Ensure task is accepted
      if (!user_data.accepted[questId][taskId]) {
        user_data.accepted[questId][taskId] = {
          accepted: true,
          timeStart: Date.now(),
          completed: false,
          hintsUsed: []
        };
      }
      
      // Only bypass if not already completed
      if (!user_data.accepted[questId][taskId].completed) {
        user_data.accepted[questId][taskId].completed = true;
        user_data.accepted[questId][taskId].timeEnd = Date.now();
        user_data.accepted[questId][taskId].bypassed = true;
        user_data.accepted[questId][taskId].bypassedBy = context.payload.comment.user.login;
        user_data.accepted[questId][taskId].bypassedAt = Date.now();
        
        totalPoints += points;
        totalXP += xp;
        tasksCount++;
      }
    }
    
    // Complete the current quest (this will accept the next quest if there is one)
    await completeQuest(user_data, questId, context, db);
    
    // Award all points and XP
    user_data.points += totalPoints;
    user_data.xp += totalXP;
    user_data.completion = calculateOverallCompletion(user_data, questConfig);
    
    // completeQuest -> acceptQuest already sets user_data.current to the next quest's T1
    // and creates the issue environments. Only set it manually if completeQuest didn't.
    if (user_data.current) {
      console.log(`🔓 [bypassAllTasks] completeQuest advanced current to ${user_data.current.quest}.${user_data.current.task}`);
    } else {
      // completeQuest didn't set current (e.g. no next quest exists) — try to set it manually
      try {
        const allQuests = Object.keys(questConfig)
          .filter(q => q.startsWith('Q') && questConfig[q] && typeof questConfig[q] === 'object')
          .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
        const currentQuestIndex = allQuests.indexOf(questId);
        if (currentQuestIndex !== -1 && currentQuestIndex < allQuests.length - 1) {
          const nextQuest = allQuests[currentQuestIndex + 1];
          const nextQuestTasks = Object.keys(questConfig[nextQuest] || {})
            .filter(t => t !== 'metadata')
            .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
          if (nextQuestTasks.length > 0) {
            user_data.current = { quest: nextQuest, task: nextQuestTasks[0] };
            console.log(`🔓 [bypassAllTasks] Manually advanced current to ${nextQuest}.${nextQuestTasks[0]}`);
          } else {
            console.log(`🔓 [bypassAllTasks] No tasks in next quest ${nextQuest}, all quests complete`);
          }
        } else {
          console.log(`🔓 [bypassAllTasks] No more quests after ${questId}, all quests complete`);
        }
      } catch (navError) {
        console.warn(`[bypassAllTasks] Error advancing to next quest:`, navError.message);
      }
    }
    
    // Close all open issues in the repository (only for the completed quest)
    try {
      const issues = await context.octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open'
      });
      
      for (const issue of issues.data) {
        // Only close issues for the bypassed quest, not the newly created next quest
        if ((issue.title.includes(`${questId} T`) || issue.title.includes(questId)) && 
            (issue.title.includes('Task') || issue.title.includes('Quest'))) {
          await context.octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            state: "closed"
          });
          console.log(`🔓 [bypassAllTasks] Closed issue #${issue.number}: ${issue.title}`);
        }
      }
    } catch (closeError) {
      console.error(`⚠️ [bypassAllTasks] Failed to close issues:`, closeError.message);
    }
    
    // Wait for next quest issues to be created before updating README
    // completeQuest schedules README update after 2s delay, but we'll do it here synchronously
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Update README (after next quest issues are created)
    try {
      await updateReadme(owner, repo, context, user_data, db);
      console.log(`🔓 [bypassAllTasks] README updated after quest completion`);
    } catch (readmeError) {
      console.error(`⚠️ [bypassAllTasks] README update failed:`, readmeError.message);
    }
    
    // Generate next task link
    let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
    try {
      const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
      const currentQuestIndex = allQuests.indexOf(questId);
      if (currentQuestIndex !== -1 && currentQuestIndex < allQuests.length - 1) {
        // Check if there's a next quest
        const nextQuest = allQuests[currentQuestIndex + 1];
        const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
        if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
          const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
          nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
        }
      }
    } catch (navError) {
      console.warn(`[bypassAllTasks] Error generating next task link:`, navError.message);
    }
    
    return `✅ **Quest ${questId} Bypassed Successfully!**\n\n` +
           `🎉 All **${tasksCount} tasks** in quest **${questId}** have been bypassed and marked as complete.\n\n` +
           `**Points Summary:**\n` +
           `- 💰 Points awarded: **${totalPoints}**\n` +
           `- ⭐ XP awarded: **${totalXP}**\n` +
           `- 📊 Your total points: **${user_data.points}**\n` +
           `- 📈 Overall completion: **${Math.round(user_data.completion * 100)}%**\n\n` +
           `**Next Steps:**\n` +
           `- Continue to ${nextTaskLink}\n` +
           `- Check your progress in the [README](https://github.com/${owner}/${repo})\n\n` +
           `🏷️ _Bypassed by class admin_`;
    
  } catch (error) {
    console.error('❌ Error in bypassAllTasks:', error);
    return `❌ Error bypassing all tasks: ${error.message}`;
  }
}

export const gameFunction = {
  completeTask,
  acceptQuest,
  completeQuest,
  displayQuests,
  createQuestEnvironment,
  validateTask,
  closeIssues,
  resetReadme,
  updateReadme,
  createRepos,
  deleteRepo,
  giveHint,
  createCustomRepos,
  markAsCompleted,
  bypassSpecificTask,
  bypassAllTasks
};

// Export getQuestConfigForUser for use by handlers
export { getQuestConfigForUser };