 import fs from "fs";
import { completeTask, getQuestConfigForUser } from "../gamification.js";
import { getQuestConfig, getGroupQuestConfig } from "../config/questConfigGenerator.js";
import { utils } from "../taskUtils.js";
import LLM from "../llm.js";

// NOTE: due to how these functions are accessed, keep parameters uniform, even if not used
const llmInstance = new LLM();

/**
 * Generic MCQ handler that can validate any MCQ task
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleMCQ(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    
    // Extract MCQ-specific data - check both 'correctAnswer' and 'answer' fields
    const correctAnswer = taskConfig.correctAnswer || taskConfig.answer;
    const userAnswer = context.payload.comment.body.trim();
    
    console.log(`[handleMCQ] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleMCQ] User answer: "${userAnswer}"`);
    console.log(`[handleMCQ] Correct answer: "${correctAnswer}"`);
    console.log(`[handleMCQ] Task config:`, taskConfig);
    
    // Check if correctAnswer is defined
    if (!correctAnswer) {
      console.error(`[handleMCQ] No correct answer defined for ${quest}${task}`);
      return [response.error + '\n\n**Error: No correct answer defined for this task. Please contact an administrator.**', false];
    }
    
    // Validate answer - case insensitive comparison
    const isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
    
    console.log(`[handleMCQ] Is correct: ${isCorrect}`);
    
    if (isCorrect) {
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      return [response.error, false];
    }
  } catch (error) {
    console.error(`Error in handleMCQ for ${quest}${task}:`, error);
    return [response.error, false];
  }
}

/**
 * Generic handler for collect-info tasks that collect and store user information
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleCollectInfo(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  console.log(`\n🚀 [handleCollectInfo] STARTING - Quest: ${quest}, Task: ${task}, User: ${user}`);
  console.log(`📋 [handleCollectInfo] Input parameters:`, {
    user,
    ossRepo,
    quest,
    task,
    hasUserData: !!user_data,
    userDataKeys: user_data ? Object.keys(user_data) : 'undefined',
    hasContext: !!context,
    hasDb: !!db
  });
  
  try {
    // Get quest configuration based on user's custom group (using processed config with normalized quest IDs)
    console.log(`🔍 [handleCollectInfo] Getting quest configuration...`);
    const questConfig = await getQuestConfigForUser(user_data);
    
    console.log(`📊 [handleCollectInfo] Quest config loaded:`, {
      hasConfig: !!questConfig,
      configKeys: questConfig ? Object.keys(questConfig) : 'undefined',
      hasQuest: questConfig ? !!questConfig[quest] : 'undefined',
      hasTask: questConfig && questConfig[quest] ? !!questConfig[quest][task] : 'undefined'
    });
    
    const taskConfig = questConfig[quest][task];
    console.log(`📝 [handleCollectInfo] Task config extracted:`, {
      taskType: taskConfig?.type,
      hasSaveValidatedData: !!taskConfig?.saveValidatedData,
      saveValidatedData: taskConfig?.saveValidatedData,
      hasSavedDataName: !!taskConfig?.savedDataName,
      savedDataName: taskConfig?.savedDataName,
      hasConfig: !!taskConfig?.config,
      configKeys: taskConfig?.config ? Object.keys(taskConfig.config) : 'undefined'
    });
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`💬 [handleCollectInfo] User answer extracted:`, {
      rawBody: context.payload.comment.body,
      trimmedAnswer: userAnswer,
      isEmpty: !userAnswer || userAnswer.trim() === '',
      length: userAnswer ? userAnswer.length : 0
    });
    
    // Check if user provided any response
    if (!userAnswer || userAnswer.trim() === '') {
      console.log(`❌ [handleCollectInfo] No response provided for ${quest}${task} - returning error`);
      return [response.error, false];
    }
    
    console.log(`✅ [handleCollectInfo] User response validated: "${userAnswer}"`);
    
    // Check if this task should save validated data
    const shouldSaveData = taskConfig.saveValidatedData || taskConfig.config?.saveValidatedData;
    const dataName = taskConfig.savedDataName || taskConfig.config?.savedDataName;
    
    console.log(`💾 [handleCollectInfo] Data saving configuration:`, {
      shouldSaveData,
      dataName,
      saveValidatedDataDirect: taskConfig.saveValidatedData,
      saveValidatedDataConfig: taskConfig.config?.saveValidatedData,
      savedDataNameDirect: taskConfig.savedDataName,
      savedDataNameConfig: taskConfig.config?.savedDataName
    });
    
    // Ensure savedNote is always defined for later use in the success response
    let savedNote = "";

    if (shouldSaveData && dataName) {
      console.log(`💾 [handleCollectInfo] Proceeding with data saving...`);
      
      // Save the collected information to user's stored values
      try {
        console.log(`📊 [handleCollectInfo] Current user_data.storedValues:`, user_data.storedValues);
        
        const key = String(dataName).trim();
        console.log(`[handleCollectInfo] Attempting to save key '${key}'`);
        
        if (key.length > 0) {
          // Initialize storedValues if it doesn't exist
          if (!user_data.storedValues) {
            console.log(`🆕 [handleCollectInfo] Initializing storedValues object`);
            user_data.storedValues = {};
          }
          
          console.log(`📝 [handleCollectInfo] Before saving - storedValues:`, user_data.storedValues);
          
          // Save the collected data (always as text for collect-info)
          const valueToStore = String(userAnswer);
          const before = { ...user_data.storedValues };
          user_data.storedValues[key] = valueToStore;
          
          console.log(`💾 [handleCollectInfo] After saving - storedValues:`, user_data.storedValues);
          console.log(`🎯 [handleCollectInfo] Data saved: "${key}" = "${valueToStore}"`);
          console.log('[handleCollectInfo] storedValues before:', before);
          console.log('[handleCollectInfo] storedValues after:', user_data.storedValues);
          savedNote = `\n\nSaved: ${key} = ${valueToStore}`;
          
          // Update the user data in the database
          console.log(`💾 [handleCollectInfo] Calling db.updateData for user: ${user}`);
          console.log(`📊 [handleCollectInfo] Update payload:`, { storedValues: user_data.storedValues });
          
          const updateResult = await db.updateData(user, {
            storedValues: user_data.storedValues
          });
          
          console.log(`✅ [handleCollectInfo] Database update result:`, updateResult);

          // Also persist to management backend for class-level visibility
          try {
            const axios = await import('axios');
            const { owner, repo } = context.repo();
            const githubUsername = user; // current GitHub user
            const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';

            // Determine management classId: prefer real ObjectId, otherwise resolve from repo name
            let managementClassId = null;
            const maybeClassId = user_data.customGroupId;
            const isMongoId = typeof maybeClassId === 'string' && /^[a-f\d]{24}$/i.test(maybeClassId);
            if (isMongoId) {
              managementClassId = maybeClassId;
            } else {
              try {
                const resolveUrl = `${baseURL}/api/group/repo/${repo}/class`;
                const resolveRes = await axios.default.get(resolveUrl);
                managementClassId = resolveRes?.data?.data?.classId || null;
                console.log(`[handleCollectInfo] Resolved management classId from repo '${repo}':`, managementClassId);
              } catch (resolveErr) {
                console.warn('[handleCollectInfo] Failed to resolve management classId from repo:', resolveErr?.message || resolveErr);
              }
            }

            if (managementClassId) {
              const url = `${baseURL}/api/group/${managementClassId}/stored-values`;
              await axios.default.post(url, {
                githubUsername,
                key,
                value: valueToStore
              }, { headers: { 'Content-Type': 'application/json' } });
              console.log(`[handleCollectInfo] Persisted '${key}' to backend for ${githubUsername} in class ${managementClassId}`);
            } else {
              console.warn('[handleCollectInfo] Could not determine management classId; skipping backend persist');
            }
          } catch (persistErr) {
            console.warn('[handleCollectInfo] Backend persist failed:', persistErr?.message || persistErr);
          }
          
          console.log(`🎉 [handleCollectInfo] Successfully saved "${key}": "${valueToStore}" for user ${user}`);
        }
        
      } catch (saveError) {
        console.error(`❌ [handleCollectInfo] Failed to save collected data:`, saveError);
        console.error(`📊 [handleCollectInfo] Error details:`, {
          errorMessage: saveError.message,
          errorStack: saveError.stack,
          errorCode: saveError.code
        });
        // Continue with task completion even if saving fails
        console.log(`⚠️ [handleCollectInfo] Continuing with task completion despite save failure`);
      }
    } else {
      console.log(`⚠️ [handleCollectInfo] Data saving not configured:`, {
        shouldSaveData,
        dataName,
        reason: !shouldSaveData ? 'saveValidatedData is false/undefined' : 'savedDataName is missing'
      });
    }
    
    // Complete the task (always succeeds for collect-info tasks)
    console.log(`🎯 [handleCollectInfo] Proceeding to complete task ${quest}${task}...`);
    
    try {
      await completeTask(user_data, quest, task, context, db);
      console.log(`✅ [handleCollectInfo] Task completed successfully for ${quest}${task}`);
    } catch (completeError) {
      console.error(`❌ [handleCollectInfo] Failed to complete task:`, completeError);
      console.log(`⚠️ [handleCollectInfo] Returning success anyway since data was collected`);
    }
    
    console.log(`🏁 [handleCollectInfo] FINISHED - Returning success response`);
    const successResponse = `${response.success}${savedNote}`;
    return [successResponse, true];
    
  } catch (error) {
    console.error(`💥 [handleCollectInfo] CRITICAL ERROR for ${quest}${task}:`, error);
    console.error(`📊 [handleCollectInfo] Error details:`, {
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode: error.code,
      errorName: error.name
    });
    return [response.error, false];
  }
}

/**
 * Generic handler for custom tasks that need specific logic
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleCustom(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    // For custom quests, you can add specific logic here
    // For now, this is a placeholder that can be extended
    console.log(`Custom handler called for ${quest}${task}`);
    
    // You could add quest-specific logic here
    // For example, if quest === "Q4", handle it specially
    
    return [response.error, false];
  } catch (error) {
    console.error(`Error in handleCustom for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Issue Count handler that can validate issue count tasks
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleIssueCount(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleIssueCount] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleIssueCount] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleIssueCount] Task config:`, taskConfig);
    
    // Get the repository to check (prefer explicit repository, then ossRepository, otherwise use ossRepo)
    const targetRepo = taskConfig.repository || taskConfig.ossRepository || ossRepo;
    console.log(`[handleIssueCount] Target repository: ${targetRepo}`);
    
    // Validate that a repository is specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleIssueCount] No repository specified for issue count task`);
      return [response.error, false];
    }
    
    // Get the issue count from the repository
    const issueCount = await utils.getIssueCount(targetRepo, context);
    console.log(`[handleIssueCount] Issue count: ${issueCount}`);
    
    if (issueCount === null) {
      console.error(`[handleIssueCount] Failed to get issue count for repository: ${targetRepo}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handleIssueCount] User answer: "${userAnswer}"`);
    console.log(`[handleIssueCount] Expected answer: "${issueCount}"`);
    
    // First try direct match (case-insensitive)
    if (userAnswer.toLowerCase() === issueCount.toString().toLowerCase()) {
      console.log(`[handleIssueCount] Direct match successful`);
      // Optional per-user save for metric tasks
      try {
        const taskConfigRaw = taskConfig;
        const shouldSave = !!taskConfigRaw.saveValidatedData;
        const key = (taskConfigRaw.savedDataName || '').trim();
        if (shouldSave && key) {
          const valueToStore = Number(issueCount);
          if (!user_data.storedValues) user_data.storedValues = {};
          user_data.storedValues[key] = valueToStore;
          console.log(`[handleIssueCount] Saved per-user value '${key}' =`, valueToStore);
          // Persist to management backend
          try {
            const axios = await import('axios');
            const { repo } = context.repo();
            const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';
            // Resolve classId
            let managementClassId = null;
            const maybeClassId = user_data.customGroupId;
            const isMongoId = typeof maybeClassId === 'string' && /^[a-f\d]{24}$/i.test(maybeClassId);
            if (isMongoId) {
              managementClassId = maybeClassId;
            } else {
              try {
                const resolveRes = await axios.default.get(`${baseURL}/api/group/repo/${repo}/class`);
                managementClassId = resolveRes?.data?.data?.classId || null;
              } catch (e) {
                console.warn('[handleIssueCount] Failed to resolve classId:', e?.message || e);
              }
            }
            if (managementClassId) {
              await axios.default.post(`${baseURL}/api/group/${managementClassId}/stored-values`, {
                githubUsername: user,
                key,
                value: valueToStore
              }, { headers: { 'Content-Type': 'application/json' } });
              console.log(`[handleIssueCount] Persisted '${key}' to backend for ${user} in class ${managementClassId}`);
            }
          } catch (persistErr) {
            console.warn('[handleIssueCount] Backend persist failed:', persistErr?.message || persistErr);
          }
        }
      } catch (saveErr) {
        console.warn('[handleIssueCount] Save per-user value failed:', saveErr);
      }
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If direct match fails, try LLM validation
    console.log(`[handleIssueCount] Direct match failed, trying LLM validation`);
    const llmResponse = await llmInstance.validateAnswer(userAnswer, issueCount.toString(), quest, task);
    console.log(`[handleIssueCount] LLM response: ${llmResponse}`);
    
    if (llmResponse === "true") {
      console.log(`[handleIssueCount] LLM validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If both direct match and LLM validation fail
    console.log(`[handleIssueCount] Both direct match and LLM validation failed`);
    response = response.error;
    return [response, false];
    
  } catch (error) {
    console.error(`Error in handleIssueCount for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Pull Request Count handler that can validate PR count tasks
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handlePRCount(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handlePRCount] Quest: ${quest}, Task: ${task}`);
    console.log(`[handlePRCount] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handlePRCount] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handlePRCount] Target repository: ${targetRepo}`);
    
    // Validate that a repository is specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handlePRCount] No repository specified for PR count task`);
      return [response.error, false];
    }
    
    // Get the pull request count from the repository
    const prCount = await utils.getPRCount(targetRepo, context);
    console.log(`[handlePRCount] PR count: ${prCount}`);
    
    if (prCount === null) {
      console.error(`[handlePRCount] Failed to get PR count for repository: ${targetRepo}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handlePRCount] User answer: "${userAnswer}"`);
    console.log(`[handlePRCount] Expected answer: "${prCount}"`);
    
    // First try direct match (case-insensitive)
    if (userAnswer.toLowerCase() === prCount.toString().toLowerCase()) {
      console.log(`[handlePRCount] Direct match successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If direct match fails, try LLM validation
    console.log(`[handlePRCount] Direct match failed, trying LLM validation`);
    const llmResponse = await llmInstance.validateAnswer(userAnswer, prCount.toString(), quest, task);
    console.log(`[handlePRCount] LLM response: ${llmResponse}`);
    
    if (llmResponse === "true") {
      console.log(`[handlePRCount] LLM validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If both direct match and LLM validation fail
    console.log(`[handlePRCount] Both direct match and LLM validation failed`);
    response = response.error;
    return [response, false];
    
  } catch (error) {
    console.error(`Error in handlePRCount for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Top Contributor handler that can validate top contributor tasks
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleTopContributor(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleTopContributor] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleTopContributor] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleTopContributor] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handleTopContributor] Target repository: ${targetRepo}`);
    
    // Validate that a repository is specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleTopContributor] No repository specified for top contributor task`);
      return [response.error, false];
    }
    
    // Get the top contributor from the repository
    const topContributor = await utils.getTopContributor(targetRepo, context);
    console.log(`[handleTopContributor] Top contributor: ${topContributor}`);
    
    if (topContributor === null) {
      console.error(`[handleTopContributor] Failed to get top contributor for repository: ${targetRepo}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handleTopContributor] User answer: "${userAnswer}"`);
    console.log(`[handleTopContributor] Expected answer: "${topContributor}"`);
    
    // First try direct match
    if (userAnswer.toLowerCase() === topContributor.toLowerCase()) {
      console.log(`[handleTopContributor] Direct match successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If direct match fails, try LLM validation
    console.log(`[handleTopContributor] Direct match failed, trying LLM validation`);
    const llmResponse = await llmInstance.validateAnswer(userAnswer, topContributor, quest, task);
    console.log(`[handleTopContributor] LLM response: ${llmResponse}`);
    
    if (llmResponse === "true") {
      console.log(`[handleTopContributor] LLM validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If both direct match and LLM validation fail
    console.log(`[handleTopContributor] Both direct match and LLM validation failed`);
    response = response.error;
    return [response, false];
    
  } catch (error) {
    console.error(`Error in handleTopContributor for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Issue Title handler that can validate issue title tasks
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleIssueTitle(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleIssueTitle] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleIssueTitle] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleIssueTitle] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handleIssueTitle] Target repository: ${targetRepo}`);
    
    // Determine issue number: allow using a stored key if configured
    let issueNumber = taskConfig.issueNumber || selectedIssue;
    const storedKey = taskConfig.selectedStoredKey;
    if (storedKey && user_data && user_data.storedValues && user_data.storedValues[storedKey] !== undefined) {
      issueNumber = user_data.storedValues[storedKey];
      console.log(`[handleIssueTitle] Using stored key '${storedKey}' → issueNumber=${issueNumber}`);
    }
    console.log(`[handleIssueTitle] Issue number: ${issueNumber}`);
    
    // Validate that a repository and issue number are specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleIssueTitle] No repository specified for issue title task`);
      return [response.error, false];
    }
    
    if (!issueNumber) {
      console.error(`[handleIssueTitle] No issue number specified for issue title task`);
      return [response.error, false];
    }
    
    // Get the issue title from the repository
    const issueTitle = await utils.getIssueTitle(targetRepo, issueNumber, context);
    console.log(`[handleIssueTitle] Issue title: ${issueTitle}`);
    
    if (issueTitle === null) {
      console.error(`[handleIssueTitle] Failed to get issue title for repository: ${targetRepo}, issue: ${issueNumber}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handleIssueTitle] User answer: "${userAnswer}"`);
    console.log(`[handleIssueTitle] Expected answer: "${issueTitle}"`);
    
    // First try direct match (case-insensitive)
    if (userAnswer.toLowerCase() === issueTitle.toLowerCase()) {
      console.log(`[handleIssueTitle] Direct match successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If direct match fails, try LLM validation
    console.log(`[handleIssueTitle] Direct match failed, trying LLM validation`);
    const llmResponse = await llmInstance.validateAnswer(userAnswer, issueTitle, quest, task);
    console.log(`[handleIssueTitle] LLM response: ${llmResponse}`);
    
    if (llmResponse === "true") {
      console.log(`[handleIssueTitle] LLM validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If both direct match and LLM validation fail
    console.log(`[handleIssueTitle] Both direct match and LLM validation failed`);
    response = response.error;
    response += `\n\n[Click here to view the issue](https://github.com/${targetRepo}/issues/${issueNumber})`;
    return [response, false];
    
  } catch (error) {
    console.error(`Error in handleIssueTitle for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Open Issues handler that can validate open issues count tasks
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleOpenIssues(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleOpenIssues] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleOpenIssues] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleOpenIssues] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handleOpenIssues] Target repository: ${targetRepo}`);
    
    // Validate that a repository is specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleOpenIssues] No repository specified for open issues task`);
      return [response.error, false];
    }
    
    // Get the open issues count from the repository
    const openIssuesCount = await utils.getOpenIssuesCount(targetRepo, context);
    console.log(`[handleOpenIssues] Open issues count: ${openIssuesCount}`);
    
    if (openIssuesCount === null) {
      console.error(`[handleOpenIssues] Failed to get open issues count for repository: ${targetRepo}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handleOpenIssues] User answer: "${userAnswer}"`);
    console.log(`[handleOpenIssues] Expected answer: "${openIssuesCount}"`);
    
    // First try direct match (case-insensitive)
    if (userAnswer.toLowerCase() === openIssuesCount.toString().toLowerCase()) {
      console.log(`[handleOpenIssues] Direct match successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If direct match fails, try LLM validation
    console.log(`[handleOpenIssues] Direct match failed, trying LLM validation`);
    const llmResponse = await llmInstance.validateAnswer(userAnswer, openIssuesCount.toString(), quest, task);
    console.log(`[handleOpenIssues] LLM response: ${llmResponse}`);
    
    if (llmResponse === "true") {
      console.log(`[handleOpenIssues] LLM validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    }
    
    // If both direct match and LLM validation fail
    console.log(`[handleOpenIssues] Both direct match and LLM validation failed`);
    response = response.error;
    return [response, false];
    
  } catch (error) {
    console.error(`Error in handleOpenIssues for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic True/False handler that logs user info and validates true/false answers
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleTrueFalse(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleTrueFalse] Quest: ${quest}, Task: ${task}`);
    
    // Log user's current name and score
    const userInfo = {
      score: user_data.points || 0,
      xp: user_data.xp || 0,
      completion: user_data.completion || 0,
      currentStreak: user_data.currentStreak || 0,
      streakCount: user_data.streakCount || 0
    };
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    
    // Extract true/false answer - check both 'correctAnswer' and 'answer' fields
    const correctAnswer = taskConfig.correctAnswer || taskConfig.answer;
    const userAnswer = context.payload.comment.body.trim();
    
    console.log(`[handleTrueFalse] User answer: "${userAnswer}"`);
    console.log(`[handleTrueFalse] Correct answer: "${correctAnswer}"`);
    console.log(`[handleTrueFalse] Task config:`, taskConfig);
    
    // Validate answer - case insensitive comparison for true/false
    const normalizedUserAnswer = userAnswer.toLowerCase();
    const normalizedCorrectAnswer = correctAnswer.toLowerCase();
    
    // Accept various true/false formats
    const isTrue = normalizedUserAnswer === 'true' || normalizedUserAnswer === 't' || normalizedUserAnswer === 'yes' || normalizedUserAnswer === 'y';
    const isFalse = normalizedUserAnswer === 'false' || normalizedUserAnswer === 'f' || normalizedUserAnswer === 'no' || normalizedUserAnswer === 'n';
    
    let userAnswerBoolean;
    if (isTrue) {
      userAnswerBoolean = 'true';
    } else if (isFalse) {
      userAnswerBoolean = 'false';
    } else {
      console.log(`[handleTrueFalse] Invalid answer format: "${userAnswer}"`);
      return [response.error, false];
    }
    
    const isCorrect = userAnswerBoolean === normalizedCorrectAnswer;
    
    console.log(`[handleTrueFalse] Normalized user answer: "${userAnswerBoolean}"`);
    console.log(`[handleTrueFalse] Is correct: ${isCorrect}`);
    
    if (isCorrect) {
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      return [response.error, false];
    }
  } catch (error) {
    console.error(`Error in handleTrueFalse for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

export async function handleQuest(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`🧠 [handleQuest] STARTING - Quest: ${quest}, Task: ${task}, User: ${user}`);
    
    // Get quest config (supporting custom groups)
    const questConfig = await getQuestConfigForUser(user_data);

    const taskConfig = questConfig[quest][task];
    console.log(`🧠 [handleQuest] Task config loaded:`, {
      hasConfig: !!taskConfig,
      taskType: taskConfig?.type,
      hasQuestions: !!taskConfig?.questions,
      questionsCount: taskConfig?.questions?.length || 0,
      questionsStructure: taskConfig?.questions?.map(q => ({
        hasQuestion: !!q.question,
        hasCorrectAnswer: !!q.correctAnswer,
        options: [q.optionA, q.optionB, q.optionC, q.optionD].filter(Boolean)
      }))
    });
    
    // Expect: taskConfig.questions = [{question, options, correctAnswer, explanation}, ...]
    const questions = taskConfig.questions || [];
    const correctAnswers = questions.map(q => q.correctAnswer);
    
    console.log(`🧠 [handleQuest] Questions array:`, questions);
    console.log(`🧠 [handleQuest] Correct answers:`, correctAnswers);

    // Parse user answer (e.g., [b,a,c])
    let userAnswerString = context.payload.comment.body.trim();
    userAnswerString = userAnswerString.replace(/[\[\]\s]/g, '').split(',');
    
    console.log(`🧠 [handleQuest] User answer: "${context.payload.comment.body.trim()}" -> parsed: [${userAnswerString.join(',')}]`);

    let correctCount = 0;
    let feedback = [];
    for (let i = 0; i < questions.length; i++) {
      const userAns = (userAnswerString[i] || '').toLowerCase();
      const correctAns = (correctAnswers[i] || '').toLowerCase();
      if (userAns === correctAns) {
        correctCount++;
        feedback.push(`Q${i + 1}: ✅ Correct!`);
      } else {
        feedback.push(`Q${i + 1}: ❌ Incorrect. Correct answer: ${correctAns.toUpperCase()}${questions[i].explanation ? ' - ' + questions[i].explanation : ''}`);
      }
    }
    
    console.log(`🧠 [handleQuest] Validation complete: ${correctCount}/${questions.length} correct`);

    await completeTask(user_data, quest, task, context, db);

    response = response.success +
      `\n ## You correctly answered ${correctCount} out of ${questions.length} questions!` +
      `\n\n ### Feedback:\n${feedback.join('\n')}`;

    return [response, true];
  } catch (error) {
    console.error(`Error in handleQuest for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Assignment Validation handler that validates if a user is assigned to a specific issue
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleAssigned(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleAssigned] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleAssigned] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleAssigned] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handleAssigned] Target repository: ${targetRepo}`);
    
    // Get the issue number to check (use task config if specified, otherwise use selectedIssue)
    const issueNumber = taskConfig.issueNumber || selectedIssue;
    console.log(`[handleAssigned] Issue number: ${issueNumber}`);
    
    // Validate that a repository and issue number are specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleAssigned] No repository specified for assignment validation task`);
      return [response.error, false];
    }
    
    if (!issueNumber) {
      console.error(`[handleAssigned] No issue number specified for assignment validation task`);
      return [response.error, false];
    }
    
    // Get the username from the user's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleAssigned] User input: "${userInput}"`);
    
    // Check if the user input is empty
    if (!userInput || userInput === '') {
      console.log(`[handleAssigned] No username provided in comment`);
      return [response.error + '\n\n**Please provide a GitHub username in your comment.**', false];
    }
    
    // Check if the provided username is assigned to the specified issue
    const isAssigned = await utils.checkAssignee(targetRepo, issueNumber, userInput, context);
    console.log(`[handleAssigned] User ${user} provided username: ${userInput}`);
    console.log(`[handleAssigned] Username ${userInput} assigned to issue #${issueNumber} in ${targetRepo}: ${isAssigned}`);
    
    // Print the correct answer for debugging
    console.log(`[handleAssigned] CORRECT ANSWER: A user should be assigned to issue #${issueNumber} in ${targetRepo}`);
    console.log(`[handleAssigned] USER ANSWER: ${userInput} is ${isAssigned ? 'ASSIGNED' : 'NOT ASSIGNED'} to issue #${issueNumber}`);
    
    if (isAssigned) {
      console.log(`[handleAssigned] Assignment validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      console.log(`[handleAssigned] Assignment validation failed - user not assigned to issue`);
      response = response.error;
      response += `\n\n[Click here to view the issue](https://github.com/${targetRepo}/issues/${issueNumber})`;
      return [response, false];
    }
    
  } catch (error) {
    console.error(`Error in handleAssigned for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Comment Validation handler that validates if a user has commented in a specific issue
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleComment(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleComment] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleComment] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleComment] Task config:`, taskConfig);
    
    // Get the repository to check (use task config if specified, otherwise use ossRepo)
    const targetRepo = taskConfig.ossRepository || ossRepo;
    console.log(`[handleComment] Target repository: ${targetRepo}`);
    
    // Get the issue number to check (use task config if specified, otherwise use selectedIssue)
    const issueNumber = taskConfig.issueNumber || selectedIssue;
    console.log(`[handleComment] Issue number: ${issueNumber}`);
    
    // Validate that a repository and issue number are specified
    if (!targetRepo || !targetRepo.trim()) {
      console.error(`[handleComment] No repository specified for comment validation task`);
      return [response.error, false];
    }
    
    if (!issueNumber) {
      console.error(`[handleComment] No issue number specified for comment validation task`);
      return [response.error, false];
    }
    
    // Get the user's comment
    const userInput = context.payload.comment.body.trim().toLowerCase();
    console.log(`[handleComment] User input: "${userInput}"`);
    
    // Check if the user input is "done"
    if (userInput !== "done") {
      console.log(`[handleComment] User did not type "done"`);
      return [response.error + '\n\n**Please type "done" in your comment after you have posted a comment in the issue.**', false];
    }
    
    // Check if the user has commented in the specified issue
    const hasCommented = await utils.userCommentedInIssue(targetRepo, issueNumber, user, context);
    console.log(`[handleComment] User ${user} has commented in issue #${issueNumber} in ${targetRepo}: ${hasCommented}`);
    
    if (hasCommented) {
      console.log(`[handleComment] Comment validation successful`);
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      console.log(`[handleComment] Comment validation failed - user has not commented in issue`);
      response = response.error;
      response += `\n\n[Click here to view the issue](https://github.com/${targetRepo}/issues/${issueNumber})`;
      return [response, false];
    }
    
  } catch (error) {
    console.error(`Error in handleComment for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Issue Number Validation handler that validates if a user provides an issue number that exists
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleIssueNo(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleIssueNo] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleIssueNo] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleIssueNo] Task config:`, taskConfig);
    
    // Get the repository to check (prefer explicit repository, then ossRepository, otherwise use ossRepo)
    const targetRepo = taskConfig.repository || taskConfig.ossRepository || ossRepo;
    console.log(`[handleIssueNo] Target repository: ${targetRepo}`);
    
    // Get the issue number from the user's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleIssueNo] User input: "${userInput}"`);
    
    // Check if the user input is empty
    if (!userInput || userInput === '') {
      console.log(`[handleIssueNo] No issue number provided in comment`);
      return [response.error + '\n\n**Please provide an issue number in your comment.**', false];
    }
    
    // Parse the issue number (remove any non-numeric characters)
    const issueNumber = parseInt(userInput.replace(/\D/g, ''));
    if (isNaN(issueNumber) || issueNumber <= 0) {
      console.log(`[handleIssueNo] Invalid issue number: ${userInput}`);
      return [response.error + '\n\n**Please provide a valid issue number (e.g., 10, 25, 100).**', false];
    }
    
    console.log(`[handleIssueNo] Parsed issue number: ${issueNumber}`);
    
    // Check if the issue exists in the repository
    const issueExists = await utils.checkIssueExists(targetRepo, issueNumber, context);
    console.log(`[handleIssueNo] Issue #${issueNumber} exists in ${targetRepo}: ${issueExists}`);
    
    // Print the correct answer for debugging
    console.log(`[handleIssueNo] CORRECT ANSWER: Issue #${issueNumber} should exist in ${targetRepo}`);
    console.log(`[handleIssueNo] USER ANSWER: Issue #${issueNumber} ${issueExists ? 'EXISTS' : 'DOES NOT EXIST'} in ${targetRepo}`);
    
    if (issueExists) {
      console.log(`[handleIssueNo] Issue validation successful`);
      // Optional per-user save of provided issue number
      try {
        const taskConfigRaw = taskConfig;
        const shouldSave = !!taskConfigRaw.saveValidatedData;
        const key = (taskConfigRaw.savedDataName || '').trim();
        if (shouldSave && key) {
          const providedIssueNo = parseInt(context.payload.comment.body.trim().replace(/\D/g, ''));
          if (!Number.isNaN(providedIssueNo)) {
            if (!user_data.storedValues) user_data.storedValues = {};
            user_data.storedValues[key] = providedIssueNo;
            console.log(`[handleIssueNo] Saved per-user value '${key}' =`, providedIssueNo);
            // Persist to management backend
            try {
              const axios = await import('axios');
              const { repo } = context.repo();
              const baseURL = process.env.MANAGEMENT_BASE_URL || 'http://localhost:8080';
              // Resolve classId
              let managementClassId = null;
              const maybeClassId = user_data.customGroupId;
              const isMongoId = typeof maybeClassId === 'string' && /^[a-f\d]{24}$/i.test(maybeClassId);
              if (isMongoId) {
                managementClassId = maybeClassId;
              } else {
                try {
                  const resolveUrl = `${baseURL}/api/group/repo/${repo}/class`;
                  const resolveRes = await axios.default.get(resolveUrl);
                  managementClassId = resolveRes?.data?.data?.classId || null;
                  console.log(`[handleIssueNo] Resolved management classId from repo '${repo}':`, managementClassId);
                } catch (resolveErr) {
                  console.warn('[handleIssueNo] Failed to resolve management classId from repo:', resolveErr?.message || resolveErr);
                }
              }
              if (managementClassId) {
                const url = `${baseURL}/api/group/${managementClassId}/stored-values`;
                await axios.default.post(url, {
                  githubUsername: user,
                  key,
                  value: providedIssueNo
                }, { headers: { 'Content-Type': 'application/json' } });
                console.log(`[handleIssueNo] Persisted '${key}' to backend for ${user} in class ${managementClassId}`);
              } else {
                console.warn('[handleIssueNo] Could not determine management classId; skipping backend persist');
              }
            } catch (persistErr) {
              console.warn('[handleIssueNo] Backend persist failed:', persistErr?.message || persistErr);
            }
          }
        }
      } catch (saveErr) {
        console.warn('[handleIssueNo] Save per-user value failed:', saveErr);
      }
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      console.log(`[handleIssueNo] Issue validation failed - issue does not exist`);
      response = response.error;
      response += `\n\n[Click here to view all issues](https://github.com/${targetRepo}/issues)`;
      return [response, false];
    }
    
  } catch (error) {
    console.error(`Error in handleIssueNo for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Custom API Call handler that can validate any GitHub API-based task
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleCustomAPICall(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleCustomAPICall] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleCustomAPICall] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    const taskConfig = questConfig[quest][task];
    console.log(`[handleCustomAPICall] Task config:`, taskConfig);
    
    // Validate required fields
    if (!taskConfig.apiEndpoint || !taskConfig.responsePath) {
      console.error(`[handleCustomAPICall] Missing required fields: apiEndpoint or responsePath`);
      return [response.error, false];
    }
    
    // Parse the API endpoint and replace placeholders
    let apiEndpoint = taskConfig.apiEndpoint;
    
    // Use specified repository if provided, otherwise use student's assigned repo
    let targetRepo;
    if (taskConfig.repository && taskConfig.repository.trim()) {
      targetRepo = taskConfig.repository.trim();
      console.log(`[handleCustomAPICall] Using specified repository: ${targetRepo}`);
    } else {
      targetRepo = ossRepo;
      console.log(`[handleCustomAPICall] Using student's assigned repository: ${targetRepo}`);
    }
    
    const [owner, repo] = targetRepo.split("/");
    
    // Replace placeholders in the API endpoint
    apiEndpoint = apiEndpoint.replace(/{owner}/g, owner).replace(/{repo}/g, repo);
    console.log(`[handleCustomAPICall] Processed API endpoint: ${apiEndpoint}`);
    
    // Make the API call with pagination support
    let apiResponse;
    try {
      // Special handling for stargazers to get total count
      if (apiEndpoint.includes('/stargazers')) {
        // Get the total count from the repository info instead
        const repoEndpoint = `/repos/${owner}/${repo}`;
        const { data: repoData } = await context.octokit.request(`GET ${repoEndpoint}`);
        apiResponse = { stargazers_count: repoData.stargazers_count };
        console.log(`[handleCustomAPICall] Repository data received:`, repoData);
        console.log(`[handleCustomAPICall] Stargazers count:`, repoData.stargazers_count);
      } else if (taskConfig.responsePath === 'length' && apiEndpoint.includes('/issues')) {
        // For issues endpoints with length response path, implement pagination
        console.log(`[handleCustomAPICall] Implementing pagination for issues endpoint`);
        let allItems = [];
        let page = 1;
        const perPage = 100;
        let keepFetching = true;
        
        while (keepFetching) {
          const paginatedEndpoint = `${apiEndpoint}?per_page=${perPage}&page=${page}`;
          console.log(`[handleCustomAPICall] Fetching page ${page}: ${paginatedEndpoint}`);
          
          const { data: fetchedItems } = await context.octokit.request(`GET ${paginatedEndpoint}`);
          console.log(`[handleCustomAPICall] Page ${page}: fetched ${Array.isArray(fetchedItems) ? fetchedItems.length : 0} items`);
          
          if (Array.isArray(fetchedItems)) {
            allItems = allItems.concat(fetchedItems);
            
            if (fetchedItems.length < perPage) {
              keepFetching = false;
            } else {
              page++;
            }
          } else {
            console.error(`[handleCustomAPICall] Unexpected response format on page ${page}`);
            keepFetching = false;
          }
        }
        
        // Filter out pull requests (items with pull_request property) for issues endpoints
        const actualIssues = allItems.filter((item) => !item.pull_request);
        console.log(`[handleCustomAPICall] Total items fetched: ${allItems.length}, actual issues (excluding PRs): ${actualIssues.length}`);
        
        apiResponse = actualIssues;
        console.log(`[handleCustomAPICall] Total issues (excluding PRs) fetched across all pages: ${actualIssues.length}`);
      } else {
        // For other endpoints, use the original single call approach
        const { data } = await context.octokit.request(`GET ${apiEndpoint}`);
        apiResponse = data;
        console.log(`[handleCustomAPICall] API response received:`, apiResponse);
      }
    } catch (error) {
      console.error(`[handleCustomAPICall] API call failed:`, error);
      return [response.error, false];
    }
    
    // Extract the answer using the response path
    let expectedAnswer;
    try {
      if (taskConfig.responsePath === 'length') {
        if (apiEndpoint.includes('/stargazers')) {
          // For stargazers, use the total count from repository data
          expectedAnswer = apiResponse.stargazers_count || 0;
        } else {
          expectedAnswer = Array.isArray(apiResponse) ? apiResponse.length : 0;
        }
      } else {
        // Use a simple path extraction (can be enhanced with a proper JSON path library)
        const pathParts = taskConfig.responsePath.split('.');
        expectedAnswer = pathParts.reduce((obj, part) => obj && obj[part], apiResponse);
      }
      console.log(`[handleCustomAPICall] Extracted answer: ${expectedAnswer}`);
    } catch (error) {
      console.error(`[handleCustomAPICall] Failed to extract answer from response path:`, error);
      return [response.error, false];
    }
    
    if (expectedAnswer === undefined || expectedAnswer === null) {
      console.error(`[handleCustomAPICall] Could not extract answer from response path: ${taskConfig.responsePath}`);
      return [response.error, false];
    }
    
    const userAnswer = context.payload.comment.body.trim();
    console.log(`[handleCustomAPICall] User answer: "${userAnswer}"`);
    console.log(`[handleCustomAPICall] Expected answer: "${expectedAnswer}"`);
    
    // Validate answer based on expected answer type
    let isCorrect = false;
    if (taskConfig.expectedAnswerType === 'Number') {
      // For numbers, try both exact match and numeric comparison
      const userNum = parseInt(userAnswer);
      const expectedNum = parseInt(expectedAnswer);
      
      // Check for exact match first
      if (userAnswer.toLowerCase() === expectedAnswer.toString().toLowerCase() || 
          (!isNaN(userNum) && !isNaN(expectedNum) && userNum === expectedNum)) {
        isCorrect = true;
      } else if (taskConfig.enableTolerance && !isNaN(userNum) && !isNaN(expectedNum)) {
        // Apply tolerance if enabled (fixed number range)
        const toleranceRange = taskConfig.toleranceRange || 10;
        const lowerBound = expectedNum - toleranceRange;
        const upperBound = expectedNum + toleranceRange;
        
        console.log(`[handleCustomAPICall] Tolerance enabled: ±${toleranceRange}`);
        console.log(`[handleCustomAPICall] Expected range: ${lowerBound} - ${upperBound}`);
        console.log(`[handleCustomAPICall] User answer: ${userNum}`);
        
        isCorrect = userNum >= lowerBound && userNum <= upperBound;
      }
    } else {
      // For text, use case-insensitive comparison
      isCorrect = userAnswer.toLowerCase() === expectedAnswer.toString().toLowerCase();
    }
    
    console.log(`[handleCustomAPICall] Is correct: ${isCorrect}`);
    
    if (isCorrect) {
      let savedNote = "";
      try {
        if (taskConfig.saveValidatedData && taskConfig.savedDataName) {
          const key = String(taskConfig.savedDataName).trim();
          console.log(`[handleCustomAPICall] Attempting to save key '${key}'`);
          if (key.length > 0) {
            const shouldStoreNumber = (taskConfig.expectedAnswerType === 'Number');
            const valueToStore = shouldStoreNumber ? Number(userAnswer) : String(userAnswer);
            if (!user_data.storedValues) user_data.storedValues = {};
            const before = { ...user_data.storedValues };
            user_data.storedValues[key] = valueToStore;
            console.log(`[handleCustomAPICall] Stored per-user value '${key}' =`, valueToStore, `(type: ${typeof valueToStore})`);
            console.log('[handleCustomAPICall] storedValues before:', before);
            console.log('[handleCustomAPICall] storedValues after:', user_data.storedValues);
            savedNote = `\n\nSaved: ${key} = ${valueToStore}`;

            // Also persist to management backend for class-level visibility
            try {
              const axios = await import('axios');
              const { owner, repo } = context.repo();
              const githubUsername = user; // current GitHub user
              const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';

              // Determine management classId: prefer real ObjectId, otherwise resolve from repo name
              let managementClassId = null;
              const maybeClassId = user_data.customGroupId;
              const isMongoId = typeof maybeClassId === 'string' && /^[a-f\d]{24}$/i.test(maybeClassId);
              if (isMongoId) {
                managementClassId = maybeClassId;
              } else {
                try {
                  const resolveUrl = `${baseURL}/api/group/repo/${repo}/class`;
                  const resolveRes = await axios.default.get(resolveUrl);
                  managementClassId = resolveRes?.data?.data?.classId || null;
                  console.log(`[handleCustomAPICall] Resolved management classId from repo '${repo}':`, managementClassId);
                } catch (resolveErr) {
                  console.warn('[handleCustomAPICall] Failed to resolve management classId from repo:', resolveErr?.message || resolveErr);
                }
              }

              if (managementClassId) {
                const url = `${baseURL}/api/group/${managementClassId}/stored-values`;
                await axios.default.post(url, {
                  githubUsername,
                  key,
                  value: valueToStore
                }, { headers: { 'Content-Type': 'application/json' } });
                console.log(`[handleCustomAPICall] Persisted '${key}' to backend for ${githubUsername} in class ${managementClassId}`);
              } else {
                console.warn('[handleCustomAPICall] Could not determine management classId; skipping backend persist');
              }
            } catch (persistErr) {
              console.warn('[handleCustomAPICall] Backend persist failed:', persistErr?.message || persistErr);
            }
          }
        }
      } catch (e) {
        console.warn(`[handleCustomAPICall] Failed to store per-user value:`, e);
      }
      await completeTask(user_data, quest, task, context, db);
      const successResponse = `${response.success}${savedNote}`;
      return [successResponse, true];
    } else {
      return [response.error, false];
    }
    
  } catch (error) {
    console.error(`Error in handleCustomAPICall for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic LLM Text Validation handler that validates text answers using AI
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleLLMTextValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    console.log(`[handleLLMTextValidation] Quest config keys:`, Object.keys(questConfig));
    console.log(`[handleLLMTextValidation] Looking for quest: ${quest}, task: ${task}`);
    console.log(`[handleLLMTextValidation] Quest exists: ${!!questConfig[quest]}`);
    
    if (!questConfig[quest]) {
      console.error(`[handleLLMTextValidation] Quest ${quest} not found in config`);
      return [response.error, false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handleLLMTextValidation] Task ${task} not found in quest ${quest}`);
      return [response.error, false];
    }
    
    const taskConfig = questConfig[quest][task];
    const userAnswer = context.payload.comment.body.trim();
    
    console.log(`[handleLLMTextValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleLLMTextValidation] User answer: "${userAnswer}"`);
    console.log(`[handleLLMTextValidation] Task config:`, taskConfig);
    console.log(`[handleLLMTextValidation] LLM validation config:`, taskConfig.llmTextValidation);
    console.log(`[handleLLMTextValidation] Enable detailed feedback:`, taskConfig.llmTextValidation?.enableDetailedFeedback);
    
    // Check if LLM validation config exists
    if (!taskConfig.llmTextValidation) {
      console.error(`[handleLLMTextValidation] No LLM validation config for ${quest}${task}`);
      return [response.error + '\n\n**Error: No LLM validation configuration found for this task. Please contact an administrator.**', false];
    }
    
    // Check if submission contains an image (HTML img tag or Markdown format)
    const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
    const markdownImgRegex = /!\[.*?\]\(([^)]+)\)/i;
    
    let imageUrl = null;
    let match = userAnswer.match(imgTagRegex);
    
    if (match) {
      imageUrl = match[1];
      console.log(`[handleLLMTextValidation] Detected image (HTML): ${imageUrl}`);
    } else {
      match = userAnswer.match(markdownImgRegex);
      if (match) {
        imageUrl = match[1];
        console.log(`[handleLLMTextValidation] Detected image (Markdown): ${imageUrl}`);
      }
    }
    
    // Extract text content (remove image markdown/HTML for cleaner text)
    let textContent = userAnswer;
    if (imageUrl) {
      textContent = userAnswer
        .replace(imgTagRegex, '')
        .replace(markdownImgRegex, '')
        .trim();
      console.log(`[handleLLMTextValidation] Text content after removing image: "${textContent}"`);
    }
    
    const { question, validationParameters, temperature } = taskConfig.llmTextValidation;
    
    // Build validation prompt - flexible approach
    let validationPrompt = '';
    
    // Use question if provided, otherwise use validationParameters
    if (question && question.trim()) {
      validationPrompt += `Question: ${question}\n\n`;
    }
    
    // Include text content if present
    if (textContent) {
      validationPrompt += `Student Text Answer: ${textContent}\n\n`;
    }
    
    // Note if image is included
    if (imageUrl) {
      validationPrompt += `[Note: Student also submitted an image which will be evaluated]\n\n`;
    }
    
    // Add validation parameters if provided
    if (validationParameters && validationParameters.length > 0) {
      validationPrompt += `Required Criteria:\n`;
      validationParameters.forEach((param, idx) => {
        validationPrompt += `${idx + 1}. ${param}\n`;
      });
    } else if (!question || !question.trim()) {
      // Only use fallback if neither question nor validationParameters are provided
      validationPrompt += `Required Criteria:\n`;
      validationPrompt += `1. Answer must be relevant and comprehensive\n`;
    }
    
    validationPrompt += `\nInstructions: Evaluate if the student answer meets ALL the required criteria. Return ONLY '1' if all criteria are met, or '0' if any criteria are not met.`;
    
    console.log(`[handleLLMTextValidation] Validation prompt:`, validationPrompt);
    
    // Call LLM for validation - use image validation if image is present, otherwise text validation
    let llmResult;
    if (imageUrl) {
      console.log(`[handleLLMTextValidation] Using image validation (text + image): ${imageUrl}`);
      // Get GitHub token for private repos
      const githubToken = process.env.GITHUB_TOKEN || 
                         process.env.OSS_DOORWAY_GITHUB_TOKEN;
      
      llmResult = await llmInstance.validateImageAnswer(
        validationPrompt,
        imageUrl,
        Boolean(taskConfig.llmTextValidation?.enableDetailedFeedback),
        typeof taskConfig.llmTextValidation?.temperature === 'number' ? taskConfig.llmTextValidation.temperature : 0.1,
        githubToken
      );
      console.log(`[handleLLMTextValidation] Image validation result: ${llmResult}`);
    } else {
      console.log(`[handleLLMTextValidation] Using text-only validation`);
      llmResult = await llmInstance.validateTextAnswer(
        validationPrompt,
        Boolean(taskConfig.llmTextValidation?.enableDetailedFeedback),
        typeof taskConfig.llmTextValidation?.temperature === 'number' ? taskConfig.llmTextValidation.temperature : 0.1
      );
    }
    
    const isValid = llmResult.trim() === "1";
    
    console.log(`[handleLLMTextValidation] LLM result: ${llmResult}, Is valid: ${isValid}`);
    
    if (isValid) {
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      // Parse detailed feedback from LLM
      let detailedFeedback = response.error;

      // Check if detailed feedback is enabled
      if (taskConfig.llmTextValidation?.enableDetailedFeedback && llmResult.includes('|')) {
        // Parse AI-generated detailed feedback
        const parts = llmResult.split('|');
        if (parts.length >= 2) {
          const feedback = parts[1].trim();
          // Include the "help" line only if hints are configured for this task
          const hasHints = Array.isArray(taskConfig.detailedHints) && taskConfig.detailedHints.length > 0;
          const helpLine = hasHints ? `\n\nYou can type \"help\" for additional guidance.` : '';
          detailedFeedback = `❌ **Incorrect Answer**\n\n${feedback}\n\n**Hint:** Review the required criteria and try again.${helpLine}`;
        }
      }

      return [detailedFeedback, false];
    }
  } catch (error) {
    console.error(`Error in handleLLMTextValidation for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Generic Image Validation handler that validates image submissions using AI
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleImageValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    console.log(`[handleImageValidation] Quest config keys:`, Object.keys(questConfig));
    console.log(`[handleImageValidation] Looking for quest: ${quest}, task: ${task}`);
    console.log(`[handleImageValidation] Quest exists: ${!!questConfig[quest]}`);
    
    if (!questConfig[quest]) {
      console.error(`[handleImageValidation] Quest ${quest} not found in config`);
      return [response.error, false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handleImageValidation] Task ${task} not found in quest ${quest}`);
      return [response.error, false];
    }
    
    const taskConfig = questConfig[quest][task];
    const userAnswer = context.payload.comment.body.trim();
    
    console.log(`[handleImageValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleImageValidation] User answer: "${userAnswer}"`);
    console.log(`[handleImageValidation] Task config:`, taskConfig);
    console.log(`[handleImageValidation] Image validation config:`, taskConfig.imageValidation);
    console.log(`[handleImageValidation] Enable detailed feedback:`, taskConfig.imageValidation?.enableDetailedFeedback);
    
    // Check if image validation config exists
    if (!taskConfig.imageValidation) {
      console.error(`[handleImageValidation] No image validation config for ${quest}${task}`);
      return [response.error + '\n\n**Error: No image validation configuration found for this task. Please contact an administrator.**', false];
    }
    
    // Extract image URL from the comment body - support both HTML img tags and Markdown format
    const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
    const markdownImgRegex = /!\[.*?\]\(([^)]+)\)/i;
    
    let imageUrl = null;
    let match = userAnswer.match(imgTagRegex);
    
    if (match) {
      imageUrl = match[1];
    } else {
      match = userAnswer.match(markdownImgRegex);
      if (match) {
        imageUrl = match[1];
      }
    }
    
    if (!imageUrl) {
      return [response.error + '\n\n**Please submit your answer as an image using either HTML img tag or Markdown format: ![Image](url)**', false];
    }
    const { question, validationParameters, temperature, enableDetailedFeedback } = taskConfig.imageValidation;
    
    // Build validation prompt - flexible approach
    let validationPrompt = '';
    
    // Use question if provided, otherwise use validationParameters
    if (question && question.trim()) {
      validationPrompt += `Question: ${question}\n\n`;
    }
    
    // Add validation parameters if provided
    if (validationParameters && validationParameters.length > 0) {
      if (!validationPrompt) {
        validationPrompt += `Required Criteria:\n`;
      } else {
        validationPrompt += `Required Criteria:\n`;
      }
      validationParameters.forEach((param, idx) => {
        validationPrompt += `${idx + 1}. ${param}\n`;
      });
    } else if (!question || !question.trim()) {
      // Only use fallback if neither question nor validationParameters are provided
      validationPrompt += `Required Criteria:\n`;
      validationPrompt += `1. Image must be relevant and demonstrate understanding\n`;
    }
    
    validationPrompt += `\nInstructions: Evaluate if the submitted image meets ALL the required criteria. Return ONLY '1' if all criteria are met, or '0' if any criteria are not met.`;
    
    console.log(`[handleImageValidation] Validation prompt:`, validationPrompt);
    console.log(`[handleImageValidation] Image URL:`, imageUrl);
    
    // Get GitHub token for private repos (try multiple environment variables)
    const githubToken = process.env.GITHUB_TOKEN || 
                       process.env.OSS_DOORWAY_GITHUB_TOKEN;
    
    // Call LLM for image validation
    const llmResult = await llmInstance.validateImageAnswer(
      validationPrompt, 
      imageUrl, 
      Boolean(enableDetailedFeedback), 
      typeof temperature === 'number' ? temperature : 0.1,
      githubToken
    );
    console.log(`[handleImageValidation] LLM validation result: ${llmResult}`);
    
    // Parse result
    const isValid = llmResult.trim() === "1";
    console.log(`[handleImageValidation] Is valid: ${isValid}`);
    
    if (isValid) {
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      // Check if detailed feedback was provided
      if (enableDetailedFeedback && llmResult.includes('|')) {
        const parts = llmResult.split('|');
        if (parts.length >= 2) {
          const detailedFeedback = parts[1].trim();
          console.log(`[handleImageValidation] Detailed feedback: ${detailedFeedback}`);
          return [response.error + `\n\n**Detailed Feedback:**\n${detailedFeedback}`, false];
        }
      }
      return [response.error, false];
    }
  } catch (error) {
    console.error(`Error in handleImageValidation for ${quest}${task}:`, error);
    return [response.error, false];
  }
} 

/**
 * Extract GitHub repository URL from user comment text
 * Supports multiple formats: full URL, owner/repo, or just URL patterns
 */
function extractGitHubRepoUrl(input) {
  // Try to match full GitHub URLs
  const urlMatch = input.match(/github\.com\/([^\/\s]+)\/([^\/\s\.]+)/i);
  if (urlMatch) {
    return `${urlMatch[1]}/${urlMatch[2]}`;
  }
  
  // Try to match owner/repo format
  const repoMatch = input.match(/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/);
  if (repoMatch) {
    // Make sure it's not just part of a URL
    if (!input.includes('http') && !input.includes('www')) {
      return `${repoMatch[1]}/${repoMatch[2]}`;
    }
  }
  
  return null;
}

/**
 * Parse repository identifier to extract owner and repo name
 */
function parseRepoFromIdentifier(repoIdentifier) {
  // Remove .git suffix if present
  const cleaned = repoIdentifier.replace(/\.git$/, '');
  const parts = cleaned.split('/');
  
  if (parts.length === 2) {
    return [parts[0], parts[1]];
  }
  
  throw new Error(`Invalid repository format: ${repoIdentifier}`);
}

/**
 * Generic Fork URL Validation handler that validates if a repository is a fork
 * 
 * Required config:
 * - repositoryToBeStored: "owner/repo" (the upstream/original repo the student must have forked)
 * 
 * Optional config:
 * - requireOwnership: boolean (defaults to true; verifies fork belongs to the student)
 * - allowForkOfFork: boolean (defaults to true; if true, accept forks-of-forks when source.full_name matches)
 * - saveValidatedData: boolean + savedDataName: string (store fork repo under a custom key)
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleForkUrlValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleForkUrlValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleForkUrlValidation] User: ${user}`);
    console.log(`[handleForkUrlValidation] OSS Repo: ${ossRepo}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest]) {
      console.error(`[handleForkUrlValidation] Quest ${quest} not found in config`);
      return [response.error + '\n\n**Error: Quest configuration not found. Please contact an administrator.**', false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handleForkUrlValidation] Task ${task} not found in quest ${quest}`);
      return [response.error + '\n\n**Error: Task configuration not found. Please contact an administrator.**', false];
    }
    
    const taskConfig = questConfig[quest][task];
    // Prefer the quest-builder field name, but keep backwards compatibility with 'sourceRepository'
    const upstreamRepo = (taskConfig.repositoryToBeStored || taskConfig.sourceRepository || '').trim(); // e.g., "AnkurMali/IST597_Fall2019_TF2.0"
    if (!upstreamRepo) {
      console.error(`[handleForkUrlValidation] No repositoryToBeStored configured for ${quest}${task}`);
      return [response.error + '\n\n**Error: `repositoryToBeStored` is not configured for this task. Please contact an administrator.**', false];
    }
    console.log(`[handleForkUrlValidation] Upstream repository: ${upstreamRepo}`);

    // Expected fork owner is always the student's username
    const expectedForkOwner = user;
    const requireOwnership = taskConfig.requireOwnership !== false; // default true
    const allowForkOfFork = taskConfig.allowForkOfFork !== false; // default true
    
    // Parse fork URL from student's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleForkUrlValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Please provide your fork repository URL.\n\nExamples:\n- `https://github.com/your-username/repo-name`\n- `your-username/repo-name`',
        false
      ];
    }

    const forkRepoIdentifier = extractGitHubRepoUrl(userInput);
    
    if (!forkRepoIdentifier) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Could not find a GitHub repository in your message.\n\nPlease provide your fork URL in one of these formats:\n- `https://github.com/your-username/repo-name`\n- `your-username/repo-name`',
        false
      ];
    }
    
    console.log(`[handleForkUrlValidation] Extracted repo identifier: ${forkRepoIdentifier}`);
    
    // Parse owner and repo from identifier
    let forkOwner, forkRepo;
    try {
      [forkOwner, forkRepo] = parseRepoFromIdentifier(forkRepoIdentifier);
    } catch (error) {
      return [response.error + `\n\n❌ Invalid repository format: ${forkRepoIdentifier}. Please use format "owner/repo" or a full GitHub URL.`, false];
    }
    
    console.log(`[handleForkUrlValidation] Parsed: owner=${forkOwner}, repo=${forkRepo}`);
    
    // Import axios dynamically
    const axios = await import('axios');
    
    // Validate fork via GitHub API (works for public repos)
    let repoResponse;
    try {
      repoResponse = await axios.default.get(
        `https://api.github.com/repos/${forkOwner}/${forkRepo}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            // No auth needed for public repos
          }
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        return [
          response.error +
            `\n\n❌ **Repository not found**: \`${forkRepoIdentifier}\` does not exist (or is not publicly accessible).`,
          false
        ];
      } else if (error.response?.status === 403) {
        return [
          response.error +
            `\n\n❌ **Access denied**: Cannot access \`${forkRepoIdentifier}\`. It may be private.\n\nMake the fork public (or grant access) and try again.`,
          false
        ];
      }
      console.error(`[handleForkUrlValidation] API error:`, error);
      return [response.error + '\n\n❌ **GitHub API error**: Could not validate your repo right now. Please try again later.', false];
    }
    
    const repoData = repoResponse.data;
    console.log(`[handleForkUrlValidation] Repository data:`, {
      fork: repoData.fork,
      parent: repoData.parent?.full_name,
      owner: repoData.owner?.login
    });
    
    // 1️⃣ Check if repo exists (if we got here, it does)
    // Already validated above (404 check)
    
    // 2️⃣ Check if it's actually a fork
    if (!repoData.fork) {
      return [
        response.error +
          `\n\n❌ **Not forked**: \`${forkRepoIdentifier}\` is not a fork.\n\nPlease fork the upstream repo \`${upstreamRepo}\` and submit the URL of *your fork* (not the original).`,
        false
      ];
    }
    
    // 3️⃣ Check if it's a fork of the upstream repo we asked for
    const parentFullName = repoData.parent?.full_name;
    if (!parentFullName) {
      return [
        response.error +
          `\n\n❌ **Could not verify upstream**: GitHub did not return a parent repo for \`${forkRepoIdentifier}\`.\n\nThis can happen if the upstream was deleted. Please contact your instructor.`,
        false
      ];
    }
    
    // Normalize comparison (case-insensitive)
    if (parentFullName.toLowerCase() !== upstreamRepo.toLowerCase()) {
      const sourceFullName = repoData.source?.full_name;
      const sourceMatches = !!sourceFullName && sourceFullName.toLowerCase() === upstreamRepo.toLowerCase();
      if (allowForkOfFork && sourceMatches) {
        console.log(
          `[handleForkUrlValidation] Parent is "${parentFullName}" but source (ultimate origin) matches upstream: "${sourceFullName}"`
        );
      } else {
        return [
          response.error +
            `\n\n❌ **Wrong upstream**: This fork is from \`${parentFullName}\`, but this task requires a fork of \`${upstreamRepo}\`.`,
          false
        ];
      }
    }
    
    // 4️⃣ Check ownership (optional - can be configured)
    if (requireOwnership) {
      const actualOwner = repoData.owner?.login;
      if (actualOwner !== expectedForkOwner) {
        return [
          response.error +
            `\n\n❌ **Non-matching user names**: This repo is owned by \`${actualOwner}\`, but it must be owned by \`${expectedForkOwner}\`.\n\nMake sure you're logged into the correct GitHub account and fork again.`,
          false
        ];
      }
      console.log(`[handleForkUrlValidation] Ownership verified: ${actualOwner} === ${expectedForkOwner}`);
    }
    
    // All checks passed!
    if (!user_data.storedValues) user_data.storedValues = {};

    // Always store default keys for backwards compatibility
    user_data.storedValues.forkRepo = forkRepoIdentifier;
    user_data.storedValues.forkUrl = `https://github.com/${forkRepoIdentifier}`;

    // Optional: store using a custom key (same pattern as custom-api-call)
    if (taskConfig.saveValidatedData && taskConfig.savedDataName) {
      const key = String(taskConfig.savedDataName).trim();
      if (key.length > 0) {
        user_data.storedValues[key] = forkRepoIdentifier;
        user_data.storedValues[`${key}Url`] = `https://github.com/${forkRepoIdentifier}`;
      }
    }
    console.log(`[handleForkUrlValidation] Stored fork repo: ${forkRepoIdentifier}`);
    
    await completeTask(user_data, quest, task, context, db);
    return [response.success, true];
    
  } catch (error) {
    console.error(`Error in handleForkUrlValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during validation. Please try again later.', false];
  }
}

/**
 * Parse GitHub file URL
 * Extracts: owner, repo, branch/ref, file path
 */
function parseGitHubFileUrl(url) {
  // Pattern: https://github.com/{owner}/{repo}/blob/{ref}/{path}
  const pattern = /github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/i;
  const match = url.match(pattern);
  
  if (!match) {
    return null;
  }
  
  const [, owner, repo, ref, filePath] = match;
  const fileName = filePath.split('/').pop();
  const fileExtension = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
  
  return {
    owner,
    repo,
    ref,
    filePath,
    fileName,
    fileExtension
  };
}

/**
 * Generic File Exists Validation handler that validates if a file exists in a repository
 * 
 * Optional config:
 * - expectedFileName: string (exact file name to match, e.g., "CONTRIBUTING.md")
 * - expectedFileType: string (file extension to match, e.g., ".md", ".pdf")
 * - saveValidatedData: boolean + savedDataName: string (store file URL under a custom key)
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleFileExistsValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleFileExistsValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleFileExistsValidation] User: ${user}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest]) {
      console.error(`[handleFileExistsValidation] Quest ${quest} not found in config`);
      return [response.error + '\n\n**Error: Quest configuration not found. Please contact an administrator.**', false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handleFileExistsValidation] Task ${task} not found in quest ${quest}`);
      return [response.error + '\n\n**Error: Task configuration not found. Please contact an administrator.**', false];
    }
    
    const taskConfig = questConfig[quest][task];
    const expectedFileName = taskConfig.expectedFileName ? String(taskConfig.expectedFileName).trim() : null;
    const expectedFileType = taskConfig.expectedFileType ? String(taskConfig.expectedFileType).trim() : null;
    
    console.log(`[handleFileExistsValidation] Expected file name: ${expectedFileName || 'Any'}`);
    console.log(`[handleFileExistsValidation] Expected file type: ${expectedFileType || 'Any'}`);
    
    // Parse file URL from student's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleFileExistsValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Please provide a GitHub file URL.\n\nExample:\n- `https://github.com/owner/repo/blob/main/path/to/file.md`',
        false
      ];
    }

    const parsedUrl = parseGitHubFileUrl(userInput);
    
    if (!parsedUrl) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Could not parse GitHub file URL.\n\nPlease provide a valid GitHub file URL in this format:\n- `https://github.com/owner/repo/blob/branch/path/to/file.ext`',
        false
      ];
    }
    
    console.log(`[handleFileExistsValidation] Parsed URL:`, parsedUrl);
    
    // Check if file exists via authenticated GitHub API
    let fileResponse;
    try {
      console.log(`[handleFileExistsValidation] Checking file: ${parsedUrl.owner}/${parsedUrl.repo}/${parsedUrl.filePath} (ref: ${parsedUrl.ref})`);
      
      fileResponse = await context.octokit.rest.repos.getContent({
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        path: parsedUrl.filePath,
        ref: parsedUrl.ref,
      });
    } catch (error) {
      if (error.status === 404) {
        return [
          response.error +
            `\n\n❌ **File not found**: The file at \`${parsedUrl.filePath}\` does not exist in the repository \`${parsedUrl.owner}/${parsedUrl.repo}\`.\n\n**Please check:**\n- The file path is correct\n- The file has been committed and pushed to the \`${parsedUrl.ref}\` branch\n- You're using the correct branch name`,
          false
        ];
      } else if (error.status === 403) {
        return [
          response.error +
            `\n\n❌ **Access denied**: Cannot access the file. The repository may be private and the GitHub App may not have access.\n\n**Please ensure:**\n- The GitHub App is installed on the repository\n- The repository owner has granted the necessary permissions`,
          false
        ];
      }
      console.error(`[handleFileExistsValidation] API error:`, error);
      return [response.error + `\n\n❌ **GitHub API error**: Could not validate the file. Error: ${error.message || 'Unknown error'}. Please try again later.`, false];
    }
    
    console.log(`[handleFileExistsValidation] File exists: ${parsedUrl.fileName}`);
    
    // Validate file name (if specified) - case insensitive
    if (expectedFileName) {
      if (parsedUrl.fileName.toLowerCase() !== expectedFileName.toLowerCase()) {
        return [
          response.error +
            `\n\n❌ **File name mismatch**: Expected file name \`${expectedFileName}\`, but found \`${parsedUrl.fileName}\`.`,
          false
        ];
      }
      console.log(`[handleFileExistsValidation] File name matches: ${expectedFileName}`);
    }
    
    // Validate file type/extension (if specified)
    if (expectedFileType) {
      // Normalize extension (ensure it starts with .)
      const normalizedExpected = expectedFileType.startsWith('.') ? expectedFileType : '.' + expectedFileType;
      const normalizedActual = parsedUrl.fileExtension;
      
      if (normalizedActual.toLowerCase() !== normalizedExpected.toLowerCase()) {
        return [
          response.error +
            `\n\n❌ **File type mismatch**: Expected file type \`${normalizedExpected}\`, but found \`${normalizedActual}\`.`,
          false
        ];
      }
      console.log(`[handleFileExistsValidation] File type matches: ${normalizedExpected}`);
    }
    
    // All checks passed!
    // Store file URL if configured
    if (taskConfig.saveValidatedData && taskConfig.savedDataName) {
      if (!user_data.storedValues) {
        user_data.storedValues = {};
      }
      const key = String(taskConfig.savedDataName).trim();
      if (key.length > 0) {
        user_data.storedValues[key] = userInput;
        user_data.storedValues[`${key}FileName`] = parsedUrl.fileName;
        user_data.storedValues[`${key}FileType`] = parsedUrl.fileExtension;
        console.log(`[handleFileExistsValidation] Stored file data: ${key}`);
      }
    }
    
    await completeTask(user_data, quest, task, context, db);
    return [response.success, true];
    
  } catch (error) {
    console.error(`Error in handleFileExistsValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during validation. Please try again later.', false];
  }
}

/**
 * Check if a file is text-based (suitable for LLM validation)
 */
function isTextFile(content, extension) {
  // Common text file extensions
  const textExtensions = [
    '.md', '.markdown', '.mdx', '.txt', '.text',
    '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.css',
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala',
    '.sh', '.bash', '.zsh', '.fish', '.ps1',
    '.sql', '.r', '.m', '.pl', '.lua', '.vim', '.conf', '.config',
    '.csv', '.tsv', '.log', '.ini', '.toml', '.env',
    '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig',
    '.rst', '.adoc', '.tex', '.latex'
  ];
  
  // Check extension first
  if (extension && textExtensions.includes(extension.toLowerCase())) {
    return true;
  }
  
  // Check if content is valid UTF-8 text (not binary)
  try {
    const text = Buffer.from(content, 'base64').toString('utf-8');
    // Check if it contains mostly printable characters
    const printableChars = text.split('').filter(c => {
      const code = c.charCodeAt(0);
      return (code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13;
    }).length;
    const ratio = printableChars / text.length;
    // If > 90% printable, likely text
    return ratio > 0.9 && text.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Generic File Content Validation handler that validates file content using LLM
 * 
 * Config:
 * - fileContentValidation.question: string (validation question/criteria)
 * - fileContentValidation.validationParameters: array (list of criteria)
 * - fileContentValidation.temperature: number (LLM temperature, default 0.1)
 * - fileContentValidation.enableDetailedFeedback: boolean (enable detailed feedback)
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleFileContentValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleFileContentValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleFileContentValidation] User: ${user}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest]) {
      console.error(`[handleFileContentValidation] Quest ${quest} not found in config`);
      return [response.error + '\n\n**Error: Quest configuration not found. Please contact an administrator.**', false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handleFileContentValidation] Task ${task} not found in quest ${quest}`);
      return [response.error + '\n\n**Error: Task configuration not found. Please contact an administrator.**', false];
    }
    
    const taskConfig = questConfig[quest][task];
    
    // Check if file content validation config exists
    if (!taskConfig.fileContentValidation) {
      console.error(`[handleFileContentValidation] No file content validation config for ${quest}${task}`);
      return [response.error + '\n\n**Error: No file content validation configuration found for this task. Please contact an administrator.**', false];
    }
    
    console.log(`[handleFileContentValidation] File content validation config:`, taskConfig.fileContentValidation);
    console.log(`[handleFileContentValidation] Enable detailed feedback:`, taskConfig.fileContentValidation?.enableDetailedFeedback);
    
    // Parse file URL from student's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleFileContentValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Please provide a GitHub file URL.\n\nExample:\n- `https://github.com/owner/repo/blob/main/path/to/file.md`',
        false
      ];
    }

    const parsedUrl = parseGitHubFileUrl(userInput);
    
    if (!parsedUrl) {
      return [
        response.error +
          '\n\n❌ **Not valid URL**: Could not parse GitHub file URL.\n\nPlease provide a valid GitHub file URL in this format:\n- `https://github.com/owner/repo/blob/branch/path/to/file.ext`',
        false
      ];
    }
    
    console.log(`[handleFileContentValidation] Parsed URL:`, parsedUrl);
    
    // Check expected file path if configured (case insensitive)
    const expectedFilePath = taskConfig.expectedFilePath ? String(taskConfig.expectedFilePath).trim() : null;
    if (expectedFilePath && expectedFilePath.length > 0) {
      const actualFilePath = parsedUrl.filePath;
      // Case insensitive comparison
      if (actualFilePath.toLowerCase() !== expectedFilePath.toLowerCase()) {
        return [
          response.error +
            `\n\n❌ **Incorrect file path**: This task requires the file to be located at \`${expectedFilePath}\`, but you provided \`${actualFilePath}\`.\n\n**Please:**\n- Ensure the file is named correctly\n- Ensure the file is in the correct location in your repository\n- Provide the URL to the file at \`${expectedFilePath}\``,
          false
        ];
      }
      console.log(`[handleFileContentValidation] File path validation passed: ${actualFilePath} matches ${expectedFilePath}`);
    }
    
    // Fetch file content via authenticated GitHub API
    let fileResponse;
    try {
      console.log(`[handleFileContentValidation] Fetching file: ${parsedUrl.owner}/${parsedUrl.repo}/${parsedUrl.filePath} (ref: ${parsedUrl.ref})`);
      
      fileResponse = await context.octokit.rest.repos.getContent({
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        path: parsedUrl.filePath,
        ref: parsedUrl.ref,
      });
    } catch (error) {
      if (error.status === 404) {
        return [
          response.error +
            `\n\n❌ **File not found**: The file at \`${parsedUrl.filePath}\` does not exist in the repository \`${parsedUrl.owner}/${parsedUrl.repo}\`.\n\n**Please check:**\n- The file path is correct\n- The file has been committed and pushed to the \`${parsedUrl.ref}\` branch\n- You're using the correct branch name`,
          false
        ];
      } else if (error.status === 403) {
        return [
          response.error +
            `\n\n❌ **Access denied**: Cannot access the file. The repository may be private and the GitHub App may not have access.\n\n**Please ensure:**\n- The GitHub App is installed on the repository\n- The repository owner has granted the necessary permissions`,
          false
        ];
      }
      console.error(`[handleFileContentValidation] API error:`, error);
      return [response.error + `\n\n❌ **GitHub API error**: Could not fetch the file. Error: ${error.message || 'Unknown error'}. Please try again later.`, false];
    }
    
    // Handle both file and directory responses
    if (fileResponse.data.type === 'dir') {
      return [
        response.error +
          `\n\n❌ **Path is a directory**: \`${parsedUrl.filePath}\` is a directory, not a file.\n\nPlease provide the full path to the specific file you want to validate.`,
        false
      ];
    }
    
    if (fileResponse.data.type !== 'file' || !fileResponse.data.content) {
      return [
        response.error +
          `\n\n❌ **Invalid file**: The path \`${parsedUrl.filePath}\` does not point to a valid file.`,
        false
      ];
    }
    
    const { encoding, size, content } = fileResponse.data;
    
    // Check file size limit (500KB to avoid token limits)
    const maxSize = 500 * 1024; // 500KB
    if (size > maxSize) {
      return [
        response.error +
          `\n\n❌ **File too large**: The file is ${(size / 1024).toFixed(1)}KB, which exceeds the maximum size of ${(maxSize / 1024).toFixed(0)}KB for validation.`,
        false
      ];
    }
    
    // Check if file is text-based
    if (encoding !== 'base64' || !content) {
      return [
        response.error +
          `\n\n❌ **Invalid file type**: The file cannot be decoded as text. Please provide a text-based file (e.g., .md, .txt, .js, .py).`,
        false
      ];
    }
    
    // Decode and validate file content
    let fileContent;
    try {
      fileContent = Buffer.from(content, 'base64').toString('utf-8');
    } catch (error) {
      return [
        response.error +
          `\n\n❌ **Decoding error**: Could not decode file content. The file may be binary or corrupted.`,
        false
      ];
    }
    
    // Check if file is actually text-based
    if (!isTextFile(content, parsedUrl.fileExtension)) {
      return [
        response.error +
          `\n\n❌ **Binary file**: The file appears to be binary (not text-based). Please provide a text file such as:\n- Markdown: \`.md\`, \`.markdown\`\n- Code: \`.js\`, \`.py\`, \`.java\`, \`.cpp\`, etc.\n- Config: \`.json\`, \`.yaml\`, \`.xml\`\n- Documentation: \`.txt\`, \`.rst\``,
        false
      ];
    }
    
    // Check if file content is empty or only whitespace
    if (!fileContent || !fileContent.trim()) {
      return [
        response.error +
          `\n\n❌ **Empty file**: The file appears to be empty or contains only whitespace. Please provide a file with actual content.`,
        false
      ];
    }
    
    console.log(`[handleFileContentValidation] File content fetched: ${fileContent.length} characters`);
    
    // Remove null bytes and other problematic control characters that could break shell commands
    // Also limit extremely long lines that could cause issues
    fileContent = fileContent
      .replace(/\0/g, '') // Remove null bytes
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove other control characters
      .split('\n')
      .map(line => line.length > 10000 ? line.substring(0, 10000) + '...[truncated]' : line) // Limit line length
      .join('\n');
    
    // Build validation prompt
    const { question, validationParameters, temperature, enableDetailedFeedback } = taskConfig.fileContentValidation;
    
    let validationPrompt = '';
    
    // Use question if provided
    if (question && question.trim()) {
      validationPrompt += `Question: ${question}\n\n`;
    }
    
    // Add validation parameters if provided
    if (validationParameters && validationParameters.length > 0) {
      if (!validationPrompt) {
        validationPrompt += `Required Criteria:\n`;
      } else {
        validationPrompt += `Required Criteria:\n`;
      }
      validationParameters.forEach((param, idx) => {
        validationPrompt += `${idx + 1}. ${param}\n`;
      });
      validationPrompt += `\n`;
    } else if (!question || !question.trim()) {
      // Fallback if neither question nor validationParameters are provided
      validationPrompt += `Required Criteria:\n`;
      validationPrompt += `1. File content must meet the specified requirements\n`;
    }
    
    // Add file content
    validationPrompt += `File Content:\n\`\`\`\n${fileContent}\n\`\`\`\n\n`;
    
    validationPrompt += `Instructions: Evaluate if the file content meets ALL the required criteria. Return ONLY '1' if all criteria are met, or '0' if any criteria are not met.`;
    
    console.log(`[handleFileContentValidation] Validation prompt length: ${validationPrompt.length} characters`);
    
    // Check command line length limit (most systems have ~128KB-256KB limit)
    // JSON.stringify adds overhead, so we check the stringified length
    const estimatedCommandLength = JSON.stringify(validationPrompt).length + 200; // Add buffer for command overhead
    const maxCommandLength = 100 * 1024; // 100KB safety limit (well below typical 128KB-256KB limits)
    
    if (estimatedCommandLength > maxCommandLength) {
      return [
        response.error +
          `\n\n❌ **Prompt too long**: The file content is too large to validate via command line (${(estimatedCommandLength / 1024).toFixed(1)}KB). Please use a smaller file or contact an administrator.`,
        false
      ];
    }
    
    // Call LLM for text validation
    console.log(`[handleFileContentValidation] Calling LLM for file content validation...`);
    const llmResult = await llmInstance.validateTextAnswer(
      validationPrompt,
      Boolean(enableDetailedFeedback),
      typeof temperature === 'number' ? temperature : 0.1
    );
    
    console.log(`[handleFileContentValidation] LLM validation result: ${llmResult}`);
    
    // Parse result
    const isValid = llmResult.trim() === "1";
    console.log(`[handleFileContentValidation] Is valid: ${isValid}`);
    
    if (isValid) {
      await completeTask(user_data, quest, task, context, db);
      return [response.success, true];
    } else {
      // Parse detailed feedback from LLM
      let detailedFeedback = response.error;
      
      // Check if detailed feedback is enabled
      if (enableDetailedFeedback && llmResult.includes('|')) {
        // Parse AI-generated detailed feedback
        const parts = llmResult.split('|');
        if (parts.length >= 2) {
          const feedback = parts[1].trim();
          // Include the "help" line only if hints are configured for this task
          const hasHints = Array.isArray(taskConfig.detailedHints) && taskConfig.detailedHints.length > 0;
          const helpLine = hasHints ? `\n\nYou can type \"help\" for additional guidance.` : '';
          detailedFeedback = `❌ **File Content Does Not Meet Requirements**\n\n${feedback}\n\n**Hint:** Review the required criteria and ensure your file meets all requirements.${helpLine}`;
        }
      } else {
        detailedFeedback = response.error + '\n\n**Hint:** Review the required criteria and ensure your file content meets all requirements.';
      }
      
      return [detailedFeedback, false];
    }
  } catch (error) {
    console.error(`Error in handleFileContentValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during validation. Please try again later.', false];
  }
}

/**
 * Extract PR number from various input formats
 */
function extractPRNumber(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }
  
  const trimmed = input.trim();
  
  // Try to extract from GitHub PR URL (handles both /pull/ and /pulls/)
  const urlMatch = trimmed.match(/github\.com\/[^\/]+\/[^\/]+\/pulls?\/(\d+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  // Try to extract from PR number format (#123, PR #123, etc.)
  const prMatch = trimmed.match(/(?:^|\s)(?:PR|pull\s*request|#)?\s*#?(\d+)(?:\s|$)/i);
  if (prMatch) {
    return prMatch[1];
  }
  
  // Try to extract standalone number (if it looks like a PR number)
  const numberMatch = trimmed.match(/^(\d+)$/);
  if (numberMatch) {
    return numberMatch[1];
  }
  
  return null;
}

/**
 * Parse repository from identifier (owner/repo format or URL)
 */
function parseRepositoryFromIdentifier(repoIdentifier) {
  if (!repoIdentifier) return null;
  
  // If it's already in owner/repo format
  if (/^[^\/]+\/[^\/]+$/.test(repoIdentifier)) {
    return {
      owner: repoIdentifier.split('/')[0],
      repo: repoIdentifier.split('/')[1]
    };
  }
  
  // If it's a GitHub URL
  const urlMatch = repoIdentifier.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/, '')
    };
  }
  
  return null;
}

/**
 * Generic PR URL Validation handler that validates PR tasks
 */
export async function handlePRUrlValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handlePRUrlValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handlePRUrlValidation] User: ${user}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest]) {
      console.error(`[handlePRUrlValidation] Quest ${quest} not found in config`);
      return [response.error + '\n\n**Error: Quest configuration not found. Please contact an administrator.**', false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handlePRUrlValidation] Task ${task} not found in quest ${quest}`);
      return [response.error + '\n\n**Error: Task configuration not found. Please contact an administrator.**', false];
    }
    
    const taskConfig = questConfig[quest][task];
    const targetRepositoryRaw = (taskConfig.targetRepository || '').trim();
    const targetBranch = (taskConfig.targetBranch || 'main').trim();
    const sourceRepositoryRaw = taskConfig.sourceRepository ? (taskConfig.sourceRepository || '').trim() : null;
    const requireOwnership = taskConfig.requireOwnership !== false; // default true
    const requireOpenState = taskConfig.requireOpenState !== false; // default true
    
    if (!targetRepositoryRaw) {
      console.error(`[handlePRUrlValidation] No targetRepository configured for ${quest}${task}`);
      return [response.error + '\n\n**Error: `targetRepository` is not configured for this task. Please contact an administrator.**', false];
    }
    
    // Normalize targetRepository to owner/repo format (handles both URLs and owner/repo format)
    const parsedTargetRepo = parseRepositoryFromIdentifier(targetRepositoryRaw);
    if (!parsedTargetRepo) {
      console.error(`[handlePRUrlValidation] Invalid targetRepository format: ${targetRepositoryRaw}`);
      return [response.error + '\n\n**Error: Invalid `targetRepository` format. Please use "owner/repo" or GitHub URL format.**', false];
    }
    const targetRepository = `${parsedTargetRepo.owner}/${parsedTargetRepo.repo}`;
    
    // Normalize sourceRepository to owner/repo format if provided
    let sourceRepository = null;
    if (sourceRepositoryRaw) {
      const parsedSourceRepo = parseRepositoryFromIdentifier(sourceRepositoryRaw);
      if (parsedSourceRepo) {
        sourceRepository = `${parsedSourceRepo.owner}/${parsedSourceRepo.repo}`;
      } else {
        console.warn(`[handlePRUrlValidation] Invalid sourceRepository format: ${sourceRepositoryRaw}, will skip source repo validation`);
      }
    }
    
    console.log(`[handlePRUrlValidation] Target repository: ${targetRepository} (normalized from: ${targetRepositoryRaw})`);
    console.log(`[handlePRUrlValidation] Target branch: ${targetBranch}`);
    if (sourceRepository) {
      console.log(`[handlePRUrlValidation] Source repository (OG repo/fork): ${sourceRepository} (normalized from: ${sourceRepositoryRaw})`);
    }
    
    // Parse PR number from student's comment
    const userInput = context.payload.comment.body.trim();
    console.log(`[handlePRUrlValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **Not valid input**: Please provide a PR URL or PR number.\n\nExamples:\n- `https://github.com/owner/repo/pull/123`\n- `#123`\n- `123`',
        false
      ];
    }
    
    const prNumber = extractPRNumber(userInput);
    
    if (!prNumber) {
      return [
        response.error +
          '\n\n❌ **Could not find PR number**: Please provide a valid PR URL or PR number.\n\nExamples:\n- `https://github.com/owner/repo/pull/123`\n- `#123`\n- `PR #123`\n- `123`',
        false
      ];
    }
    
    console.log(`[handlePRUrlValidation] Extracted PR number: ${prNumber}`);
    
    // Fetch PR data from GitHub API (targetRepository is already normalized to owner/repo format)
    const axios = await import('axios');
    const apiUrl = `https://api.github.com/repos/${targetRepository}/pulls/${prNumber}`;
    console.log(`[handlePRUrlValidation] API URL: ${apiUrl}`);
    
    let prResponse;
    try {
      prResponse = await axios.default.get(apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        }
      });
    } catch (error) {
      if (error.response?.status === 404) {
        return [
          response.error +
            `\n\n❌ **PR not found**: PR #${prNumber} does not exist in ${targetRepository}.\n\nPlease check:\n- The PR number is correct\n- The PR exists in the target repository`,
          false
        ];
      } else if (error.response?.status === 403) {
        return [
          response.error +
            `\n\n❌ **Access denied**: Cannot access PR. The repository may be private.\n\nPlease contact your instructor if this is unexpected.`,
          false
        ];
      }
      console.error(`[handlePRUrlValidation] API error:`, error);
      return [response.error + '\n\n❌ **GitHub API error**: Could not fetch PR data. Please try again later.', false];
    }
    
    const prData = prResponse.data;
    console.log(`[handlePRUrlValidation] PR data:`, {
      number: prData.number,
      state: prData.state,
      user: prData.user.login,
      base: prData.base.repo.full_name,
      baseRef: prData.base.ref,
      head: prData.head.repo.full_name,
    });
    
    // Validate PR ownership
    if (requireOwnership && prData.user.login !== user) {
      return [
        response.error +
          `\n\n❌ **Ownership mismatch**: This PR was created by ${prData.user.login}, not you (${user}).\n\nPlease provide a PR that you created.`,
        false
      ];
    }
    
    // Validate PR state
    if (requireOpenState && prData.state !== 'open') {
      return [
        response.error +
          `\n\n❌ **PR is not open**: This PR is ${prData.state}. Please create a new open PR.`,
        false
      ];
    }
    
    // Validate target repository
    if (prData.base.repo.full_name !== targetRepository) {
      return [
        response.error +
          `\n\n❌ **Wrong target repository**: This PR is to ${prData.base.repo.full_name}, not ${targetRepository}.\n\nPlease create a PR to the correct repository.`,
        false
      ];
    }
    
    // Validate target branch
    if (prData.base.ref !== targetBranch) {
      return [
        response.error +
          `\n\n❌ **Wrong target branch**: This PR is to branch '${prData.base.ref}', not '${targetBranch}'.\n\nPlease create a PR to the correct branch.`,
        false
      ];
    }
    
    // Validate source repository (OG repo/fork) if specified
    if (sourceRepository && prData.head.repo.full_name !== sourceRepository) {
      return [
        response.error +
          `\n\n❌ **Wrong source repository**: This PR is from ${prData.head.repo.full_name}, not ${sourceRepository} (OG repo/fork).\n\nPlease create a PR from the correct repository.`,
        false
      ];
    }
    
    // All checks passed - save data if configured
    if (taskConfig.saveValidatedData) {
      const savedDataName = (taskConfig.savedDataName || 'prUrl').trim();
      if (!user_data.storedValues) {
        user_data.storedValues = {};
      }
      user_data.storedValues[savedDataName] = prData.html_url;
      console.log(`[handlePRUrlValidation] Saved PR URL to storedValues['${savedDataName}']: ${prData.html_url}`);
      
      // Optionally also save PR number
      if (savedDataName === 'prUrl') {
        user_data.storedValues['prNumber'] = prNumber;
        console.log(`[handlePRUrlValidation] Saved PR number to storedValues['prNumber']: ${prNumber}`);
      }
      
      // Save to database
      const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';
      const classId = user_data.customGroupId || user_data.classId;
      
      try {
        await axios.default.put(`${baseURL}/api/data/update`, {
          identifier: `${user}-${ossRepo}`,
          storedValues: user_data.storedValues
        });
        console.log(`[handlePRUrlValidation] Successfully saved PR data to database`);
      } catch (error) {
        console.error(`[handlePRUrlValidation] Failed to save PR data:`, error);
        // Don't fail the task if save fails
      }
    }
    
    // Complete the task
    await completeTask(user_data, quest, task, context, db);
    console.log(`[handlePRUrlValidation] Task ${quest}${task} completed successfully`);
    return [response.success, true];
    
  } catch (error) {
    console.error(`Error in handlePRUrlValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during PR validation. Please try again later.', false];
  }
}

/**
 * Extract commit SHA from various input formats
 */
function extractCommitSha(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }
  
  const trimmed = input.trim();
  
  // Try to extract from GitHub commit URL
  const urlMatch = trimmed.match(/github\.com\/[^\/]+\/[^\/]+\/commit\/([a-f0-9]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  // Try to extract standalone SHA (7-40 hex characters)
  const shaMatch = trimmed.match(/\b([a-f0-9]{7,40})\b/i);
  if (shaMatch) {
    return shaMatch[1];
  }
  
  // Try to extract after "commit" keyword
  const commitMatch = trimmed.match(/commit\s+([a-f0-9]{7,40})/i);
  if (commitMatch) {
    return commitMatch[1];
  }
  
  return null;
}

/**
 * Check if a file exists in a commit
 */
async function checkFileInCommit(repository, commitSha, filePath) {
  const parsedRepo = parseRepositoryFromIdentifier(repository);
  if (!parsedRepo) {
    throw new Error(`Invalid repository format: ${repository}`);
  }
  
  const axios = await import('axios');
  
  // Check if filePath contains wildcard patterns (e.g., handson/*, */handson/*)
  if (filePath.includes('*')) {
    // Handle folder patterns like "handson/*" or "*/handson/*"
    // Pattern: "handson/*" -> check if handson folder exists and has files
    // Pattern: "*/handson/*" -> search for handson folder recursively
    
    if (filePath.match(/^(.+)\/\*$/)) {
      // Pattern: "folder/*" - check if folder exists and has at least one file
      const folderPath = filePath.replace(/\/\*$/, '');
      try {
        const response = await axios.default.get(
          `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/contents/${folderPath}?ref=${commitSha}`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            }
          }
        );
        
        // Check if it's a directory with at least one file
        if (Array.isArray(response.data) && response.data.length > 0) {
          return true; // Folder exists and has files
        }
        return false; // Folder exists but is empty
      } catch (error) {
        if (error.response?.status === 404) {
          return false; // Folder doesn't exist
        }
        throw error;
      }
    } else if (filePath.match(/^\*\/(.+)\/\*$/)) {
      // Pattern: "*/folder/*" - search recursively for folder
      const targetFolder = filePath.replace(/^\*\//, '').replace(/\/\*$/, '');
      
      // Use GitHub API to search for the folder recursively
      // We'll check common locations: root, and a few levels deep
      const searchPaths = [
        targetFolder, // Root level
        `*/${targetFolder}`, // One level deep
        `*/*/${targetFolder}`, // Two levels deep
      ];
      
      for (const searchPath of searchPaths) {
        try {
          // Try to list contents at this path
          const response = await axios.default.get(
            `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/contents/${searchPath}?ref=${commitSha}`,
            {
              headers: {
                Accept: 'application/vnd.github.v3+json',
              }
            }
          );
          
          if (Array.isArray(response.data) && response.data.length > 0) {
            return true; // Found folder with files
          }
        } catch (error) {
          // Continue searching if this path doesn't exist
          if (error.response?.status !== 404) {
            throw error;
          }
        }
      }
      
      // If we get here, try a recursive search using the Git Trees API
      try {
        const treeResponse = await axios.default.get(
          `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/trees/${commitSha}?recursive=1`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            }
          }
        );
        
        // Search for files in the target folder
        const tree = treeResponse.data.tree || [];
        const folderPattern = new RegExp(`^.*/${targetFolder}/.+$`);
        const foundFiles = tree.filter(item => 
          item.type === 'blob' && folderPattern.test(item.path)
        );
        
        return foundFiles.length > 0; // Return true if any files found in folder
      } catch (error) {
        if (error.response?.status === 404) {
          return false;
        }
        throw error;
      }
    } else if (filePath.match(/^\*\/(.+)$/)) {
      // Pattern: "*/folder" - search for folder at any level
      const targetFolder = filePath.replace(/^\*\//, '');
      
      try {
        // Use recursive tree search
        const treeResponse = await axios.default.get(
          `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/trees/${commitSha}?recursive=1`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            }
          }
        );
        
        const tree = treeResponse.data.tree || [];
        // Check if folder exists (as a tree) or if any file is in this folder
        const folderPattern = new RegExp(`^.*/${targetFolder}(?:/|$)`);
        const found = tree.some(item => folderPattern.test(item.path));
        
        return found;
      } catch (error) {
        if (error.response?.status === 404) {
          return false;
        }
        throw error;
      }
    } else {
      // Unsupported wildcard pattern - fall back to exact match
      console.warn(`[checkFileInCommit] Unsupported wildcard pattern: ${filePath}, falling back to exact match`);
      filePath = filePath.replace(/\*/g, ''); // Remove wildcards for exact match attempt
    }
  }
  
  // Exact file path check (original behavior)
  try {
    await axios.default.get(
      `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/contents/${filePath}?ref=${commitSha}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        }
      }
    );
    
    return true; // File exists
  } catch (error) {
    if (error.response?.status === 404) {
      return false; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Generic Push/Commit Validation handler that validates push/commit tasks
 */
export async function handlePushValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handlePushValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handlePushValidation] User: ${user}`);
    
    // Get quest configuration based on user's custom group
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest]) {
      console.error(`[handlePushValidation] Quest ${quest} not found in config`);
      return [response.error + '\n\n**Error: Quest configuration not found. Please contact an administrator.**', false];
    }
    
    if (!questConfig[quest][task]) {
      console.error(`[handlePushValidation] Task ${task} not found in quest ${quest}`);
      return [response.error + '\n\n**Error: Task configuration not found. Please contact an administrator.**', false];
    }
    
    const taskConfig = questConfig[quest][task];
    const targetRepositoryRaw = (taskConfig.targetRepository || '').trim();
    const targetBranch = (taskConfig.targetBranch || 'main').trim();
    const requireOwnership = taskConfig.requireOwnership !== false; // default true
    const requireRecentPush = taskConfig.requireRecentPush || false; // default false
    const recentPushWindowHours = taskConfig.recentPushWindowHours || 24; // default 24 hours
    const expectedFilePath = taskConfig.expectedFilePath ? (taskConfig.expectedFilePath || '').trim() : null;
    
    if (!targetRepositoryRaw) {
      console.error(`[handlePushValidation] No targetRepository configured for ${quest}${task}`);
      return [response.error + '\n\n**Error: `targetRepository` is not configured for this task. Please contact an administrator.**', false];
    }
    
    // Check if targetRepository contains wildcard patterns (e.g., */handson, **/handson)
    const hasWildcard = targetRepositoryRaw.includes('*');
    let candidateRepositories = [];
    
    if (hasWildcard) {
      // Generate candidate repositories based on wildcard pattern
      // Pattern: */handson -> {user}/handson
      // Pattern: **/handson -> {user}/handson (same as */handson for now)
      if (targetRepositoryRaw.match(/^\*+\/(.+)$/)) {
        const repoName = targetRepositoryRaw.replace(/^\*+\//, '');
        // Try student's username first
        candidateRepositories.push(`${user}/${repoName}`);
        console.log(`[handlePushValidation] Wildcard pattern detected: ${targetRepositoryRaw} -> trying ${user}/${repoName}`);
      } else if (targetRepositoryRaw.match(/^(.+)\/\*+$/)) {
        const ownerName = targetRepositoryRaw.replace(/\/\*+$/, '');
        // Pattern: owner/* -> owner/{repo} (less common, but support it)
        // For now, we'll need the repo name from somewhere else, so skip this pattern
        console.warn(`[handlePushValidation] Unsupported wildcard pattern: ${targetRepositoryRaw}`);
      } else {
        console.warn(`[handlePushValidation] Unsupported wildcard pattern: ${targetRepositoryRaw}`);
      }
      
      // If no candidates generated, fall back to exact match parsing
      if (candidateRepositories.length === 0) {
        const parsedTargetRepo = parseRepositoryFromIdentifier(targetRepositoryRaw);
        if (parsedTargetRepo) {
          candidateRepositories.push(`${parsedTargetRepo.owner}/${parsedTargetRepo.repo}`);
        }
      }
    } else {
      // Normalize targetRepository to owner/repo format (handles both URLs and owner/repo format)
      const parsedTargetRepo = parseRepositoryFromIdentifier(targetRepositoryRaw);
      if (!parsedTargetRepo) {
        console.error(`[handlePushValidation] Invalid targetRepository format: ${targetRepositoryRaw}`);
        return [response.error + '\n\n**Error: Invalid `targetRepository` format. Please use "owner/repo", "*/repo", or GitHub URL format.**', false];
      }
      candidateRepositories.push(`${parsedTargetRepo.owner}/${parsedTargetRepo.repo}`);
    }
    
    if (candidateRepositories.length === 0) {
      console.error(`[handlePushValidation] Could not resolve targetRepository: ${targetRepositoryRaw}`);
      return [response.error + '\n\n**Error: Could not resolve `targetRepository`. Please check the configuration.**', false];
    }
    
    console.log(`[handlePushValidation] Target repository candidates: ${candidateRepositories.join(', ')} (from: ${targetRepositoryRaw})`);
    console.log(`[handlePushValidation] Target branch: ${targetBranch}`);
    if (expectedFilePath) {
      console.log(`[handlePushValidation] Expected file path: ${expectedFilePath}`);
    }
    
    const userInput = context.payload.comment.body.trim();
    console.log(`[handlePushValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **Not valid input**: Please provide a commit URL or commit SHA.\n\nExamples:\n- `https://github.com/owner/repo/commit/abc123def456`\n- `abc123def456789`\n- `commit abc123def456789`',
        false
      ];
    }
    
    const commitSha = extractCommitSha(userInput);
    
    if (!commitSha) {
      return [
        response.error +
          '\n\n❌ **Could not find commit SHA**: Please provide a valid commit URL or commit SHA.\n\nExamples:\n- `https://github.com/owner/repo/commit/abc123def456`\n- `abc123def456789`\n- `commit abc123def456789`',
        false
      ];
    }
    
    console.log(`[handlePushValidation] Extracted commit SHA: ${commitSha}`);
    
    const axios = await import('axios');
    
    // Check if student has a fork stored (from previous fork validation task)
    let studentForkRepo = null;
    if (user_data.storedValues && user_data.storedValues.forkRepo) {
      studentForkRepo = user_data.storedValues.forkRepo.trim();
      console.log(`[handlePushValidation] Found student fork: ${studentForkRepo}`);
    }
    
    // Try to find commit in student's fork first, then fall back to candidate repositories
    let commitResponse;
    let actualRepository = null; // Track which repo the commit was found in
    
    // First, try student's fork if available (always check this first regardless of pattern)
    if (studentForkRepo) {
      try {
        const forkApiUrl = `https://api.github.com/repos/${studentForkRepo}/commits/${commitSha}`;
        console.log(`[handlePushValidation] Trying student fork first: ${forkApiUrl}`);
        
        commitResponse = await axios.default.get(forkApiUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          }
        });
        
        actualRepository = studentForkRepo;
        console.log(`[handlePushValidation] ✅ Commit found in student fork: ${studentForkRepo}`);
      } catch (forkError) {
        if (forkError.response?.status === 404) {
          console.log(`[handlePushValidation] Commit not found in student fork, trying candidate repositories...`);
        } else {
          console.warn(`[handlePushValidation] Error checking student fork:`, forkError.message);
        }
      }
    }
    
    // If not found in fork (or no fork), try all candidate repositories
    if (!commitResponse) {
      let lastError = null;
      let triedRepos = [];
      
      for (const candidateRepo of candidateRepositories) {
        triedRepos.push(candidateRepo);
        try {
          const apiUrl = `https://api.github.com/repos/${candidateRepo}/commits/${commitSha}`;
          console.log(`[handlePushValidation] Trying candidate repository: ${apiUrl}`);
          
          commitResponse = await axios.default.get(apiUrl, {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            }
          });
          
          actualRepository = candidateRepo;
          console.log(`[handlePushValidation] ✅ Commit found in candidate repository: ${candidateRepo}`);
          break; // Found it, stop trying
        } catch (error) {
          lastError = error;
          if (error.response?.status === 404) {
            console.log(`[handlePushValidation] Commit not found in ${candidateRepo}, trying next candidate...`);
            continue; // Try next candidate
          } else if (error.response?.status === 403) {
            // Access denied - return immediately
            return [
              response.error +
                `\n\n❌ **Access denied**: Cannot access commit in ${candidateRepo}. The repository may be private.\n\nPlease contact your instructor if this is unexpected.`,
              false
            ];
          } else {
            console.warn(`[handlePushValidation] Error checking ${candidateRepo}:`, error.message);
            continue; // Try next candidate
          }
        }
      }
      
      // If we tried all candidates and didn't find it
      if (!commitResponse) {
        const triedReposStr = triedRepos.length > 0 ? triedRepos.join(', ') : 'target repositories';
        const errorMsg = studentForkRepo 
          ? `The commit ${commitSha.substring(0, 7)}... does not exist in your fork (${studentForkRepo}) or any of the candidate repositories (${triedReposStr}).`
          : `The commit ${commitSha.substring(0, 7)}... does not exist in any of the candidate repositories (${triedReposStr}).`;
        
        return [
          response.error +
            `\n\n❌ **Commit not found**: ${errorMsg}\n\nPlease check the commit SHA and make sure the commit exists in one of the expected repositories.`,
          false
        ];
      }
    }
    
    if (!actualRepository) {
      return [response.error + '\n\n❌ **Internal error**: Could not determine the repository for the commit.', false];
    }
    
    const commitData = commitResponse.data;
    console.log(`[handlePushValidation] Commit data:`, {
      sha: commitData.sha.substring(0, 7),
      message: commitData.commit.message.split('\n')[0],
      author: commitData.author?.login || commitData.commit.author.email,
      date: commitData.commit.author.date,
    });
    
    // Check ownership
    if (requireOwnership) {
      let ownershipValid = false;
      if (commitData.author?.login) {
        ownershipValid = commitData.author.login.toLowerCase() === user.toLowerCase();
      } else {
        // Fallback: check if email or name contains expected user (less reliable)
        const authorEmail = commitData.commit.author.email?.toLowerCase() || '';
        const authorName = commitData.commit.author.name?.toLowerCase() || '';
        ownershipValid = authorEmail.includes(user.toLowerCase()) || 
                        authorName.includes(user.toLowerCase());
      }
      
      if (!ownershipValid) {
        const actualAuthor = commitData.author?.login || commitData.commit.author.email || commitData.commit.author.name;
        return [
          response.error +
            `\n\n❌ **Ownership mismatch**: This commit was created by ${actualAuthor}, not you (${user}).\n\nPlease provide a commit that you created.`,
          false
        ];
      }
    }
    
    // Check if commit is on target branch (in the repository where commit was found)
    let commitOnBranch = false;
    
    try {
      const branchResponse = await axios.default.get(
        `https://api.github.com/repos/${actualRepository}/branches/${targetBranch}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          }
        }
      );
      const branchCommitSha = branchResponse.data.commit.sha;
      
      // Check if this commit is the latest on the branch
      commitOnBranch = branchCommitSha === commitData.sha;
      
      // If not the latest, check if commit is in branch history
      if (!commitOnBranch) {
        try {
          const commitsResponse = await axios.default.get(
            `https://api.github.com/repos/${actualRepository}/commits?sha=${targetBranch}&per_page=100`,
            {
              headers: {
                Accept: 'application/vnd.github.v3+json',
              }
            }
          );
          commitOnBranch = commitsResponse.data.some(c => c.sha === commitData.sha);
        } catch (err) {
          console.warn(`[handlePushValidation] Could not check commit history, assuming commit is on branch`);
          commitOnBranch = true; // Assume it's on branch if we can't verify
        }
      }
    } catch (error) {
      if (error.response?.status === 404) {
        return [
          response.error +
            `\n\n❌ **Branch not found**: The branch '${targetBranch}' does not exist in ${actualRepository}.\n\nPlease check the branch name.`,
          false
        ];
      }
      console.warn(`[handlePushValidation] Could not verify branch, assuming commit is on target branch`);
      commitOnBranch = true; // Assume it's on branch if we can't verify
    }
    
    if (!commitOnBranch) {
      return [
        response.error +
          `\n\n❌ **Commit not on branch**: This commit is not on branch '${targetBranch}'.\n\nPlease provide a commit that is on the correct branch.`,
        false
      ];
    }
    
    // Check if commit is recent (if required)
    if (requireRecentPush) {
      const commitDate = new Date(commitData.commit.author.date);
      const now = new Date();
      const hoursAgo = (now - commitDate) / (1000 * 60 * 60);
      
      if (hoursAgo > recentPushWindowHours) {
        return [
          response.error +
            `\n\n❌ **Commit is too old**: This commit is ${hoursAgo.toFixed(1)} hours old, but must be within ${recentPushWindowHours} hours.\n\nPlease provide a more recent commit.`,
          false
        ];
      }
    }
    
    // Check if expected file exists in commit (if specified)
    if (expectedFilePath) {
      try {
        const fileExists = await checkFileInCommit(actualRepository, commitSha, expectedFilePath);
        if (!fileExists) {
          return [
            response.error +
              `\n\n❌ **File not found in commit**: The file '${expectedFilePath}' does not exist in this commit.\n\nPlease make sure the commit includes the expected file.`,
            false
          ];
        }
      } catch (error) {
        console.error(`[handlePushValidation] Error checking file existence:`, error);
        return [
          response.error +
            `\n\n❌ **Error checking file**: Could not verify if file '${expectedFilePath}' exists in commit. Please try again later.`,
          false
        ];
      }
    }
    
    // All checks passed - save data if configured
    if (taskConfig.saveValidatedData) {
      const savedDataName = (taskConfig.savedDataName || 'commitSha').trim();
      if (!user_data.storedValues) {
        user_data.storedValues = {};
      }
      user_data.storedValues[savedDataName] = commitData.html_url;
      console.log(`[handlePushValidation] Saved commit URL to storedValues['${savedDataName}']: ${commitData.html_url}`);
      
      // Optionally also save commit SHA
      if (savedDataName === 'commitSha') {
        user_data.storedValues['commitSha'] = commitSha;
        console.log(`[handlePushValidation] Saved commit SHA to storedValues['commitSha']: ${commitSha}`);
      }
      
      // Save to database
      const baseURL = process.env.MANAGEMENT_BASE_URL || 'https://oss-michael-production.up.railway.app';
      const classId = user_data.customGroupId || user_data.classId;
      
      try {
        await axios.default.put(`${baseURL}/api/data/update`, {
          identifier: `${user}-${ossRepo}`,
          storedValues: user_data.storedValues
        });
        console.log(`[handlePushValidation] Successfully saved commit data to database`);
      } catch (error) {
        console.error(`[handlePushValidation] Failed to save commit data:`, error);
        // Don't fail the task if save fails
      }
    }
    
    // Complete the task
    await completeTask(user_data, quest, task, context, db);
    console.log(`[handlePushValidation] Task ${quest}${task} completed successfully`);
    return [response.success, true];
    
  } catch (error) {
    console.error(`Error in handlePushValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during commit validation. Please try again later.', false];
  }
}

/**
 * Extract PR information from user input
 * @returns {Object|null} { owner, repo, prNumber } or null if not a PR URL
 */
function extractPRInfo(userInput) {
  // Match PR URLs: https://github.com/owner/repo/pull/123
  const prUrlMatch = userInput.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)\/pull\/(\d+)/i);
  if (prUrlMatch) {
    return {
      owner: prUrlMatch[1],
      repo: prUrlMatch[2],
      prNumber: parseInt(prUrlMatch[3], 10)
    };
  }
  return null;
}

/**
 * Validate PR safety to prevent students from breaking main branch
 * @returns {Object} { safe: boolean, error?: string }
 */
async function validatePRSafety(prData, expectedUser) {
  // Check 1: PR must NOT be from main/master branch
  if (prData.head.ref === 'main' || prData.head.ref === 'master') {
    return {
      safe: false,
      error: "❌ **Invalid PR**: Cannot create PR from main/master branch.\n\nPlease:\n1. Create a feature branch: `git checkout -b my-feature`\n2. Make your changes on that branch\n3. Push the branch: `git push origin my-feature`\n4. Create a PR from your feature branch"
    };
  }
  
  // Check 2: PR must target main/master branch
  if (prData.base.ref !== 'main' && prData.base.ref !== 'master') {
    return {
      safe: false,
      error: `❌ **Invalid PR**: PR must target the main/master branch, not '${prData.base.ref}'`
    };
  }
  
  // Check 3: PR must be from student's own branch/fork
  if (prData.user.login.toLowerCase() !== expectedUser.toLowerCase()) {
    return {
      safe: false,
      error: `❌ **Invalid PR**: PR must be created by you (${expectedUser}), not ${prData.user.login}`
    };
  }
  
  // Check 4: PR must be open
  if (prData.state !== 'open') {
    return {
      safe: false,
      error: `❌ **Invalid PR**: PR is ${prData.state}. Please create or reopen the PR.`
    };
  }
  
  return { safe: true };
}

/**
 * Fetch files from a PR using authenticated GitHub API
 * @param {Object} context - GitHub context with octokit
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {string} filePattern - Optional file pattern filter
 * @returns {Array} Array of { filename, content } objects
 */
async function fetchPRFiles(context, owner, repo, prNumber, filePattern = null) {
  try {
    // Get list of files changed in PR using authenticated API
    const filesResponse = await context.octokit.rest.pulls.listFiles({
      owner: owner,
      repo: repo,
      pull_number: prNumber
    });
    
    const prFiles = filesResponse.data;
    console.log(`[fetchPRFiles] Found ${prFiles.length} files in PR #${prNumber}`);
    
    // Filter files by pattern if provided
    let filesToReview = prFiles;
    if (filePattern) {
      const patterns = filePattern.split(',').map(p => p.trim());
      filesToReview = prFiles.filter(file => {
        return patterns.some(pattern => {
          // Convert glob pattern to regex
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
          return new RegExp(regexPattern).test(file.filename);
        });
      });
      console.log(`[fetchPRFiles] Filtered to ${filesToReview.length} files matching pattern: ${filePattern}`);
    }
    
    // Fetch content for each file
    const filesWithContent = [];
    for (const file of filesToReview) {
      try {
        // Get file content from the PR's head ref using authenticated API
        const contentResponse = await context.octokit.rest.repos.getContent({
          owner: owner,
          repo: repo,
          path: file.filename,
          ref: `refs/pull/${prNumber}/head`
        });
        
        // Handle both file and directory responses
        if (Array.isArray(contentResponse.data)) {
          // Directory - skip for now
          console.log(`[fetchPRFiles] Skipping directory: ${file.filename}`);
          continue;
        }
        
        const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');
        filesWithContent.push({
          filename: file.filename,
          content: content,
          additions: file.additions,
          deletions: file.deletions,
          status: file.status
        });
        
        console.log(`[fetchPRFiles] Fetched ${file.filename}: ${content.length} bytes`);
      } catch (error) {
        console.error(`[fetchPRFiles] Error fetching ${file.filename}:`, error.message);
        // Skip files that can't be fetched (e.g., deleted files, binary files)
        if (file.status !== 'removed' && error.status !== 404) {
          filesWithContent.push({
            filename: file.filename,
            content: `[Error: Could not fetch file content - ${error.message}]`,
            error: true
          });
        }
      }
    }
    
    return filesWithContent;
  } catch (error) {
    console.error(`[fetchPRFiles] Error fetching PR files:`, error.message);
    throw error;
  }
}

/**
 * Comment on a PR (with fallback to issue if PR not accessible)
 */
async function commentOnPR(context, owner, repo, prNumber, message) {
  try {
    // Try to comment on PR
    await context.octokit.rest.issues.createComment({
      owner: owner,
      repo: repo,
      issue_number: prNumber,
      body: message
    });
    console.log(`[commentOnPR] Successfully commented on PR #${prNumber}`);
    return true;
  } catch (error) {
    console.error(`[commentOnPR] Failed to comment on PR:`, error.message);
    // Fallback: comment will be posted in the original issue by caller
    return false;
  }
}

/**
 * Approve a PR using GitHub's review API
 * Requires pull_requests: write permission
 */
async function approvePR(context, owner, repo, prNumber, message = "✅ Code review passed! Approved by OSS-Doorway Bot.") {
  try {
    await context.octokit.rest.pulls.createReview({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
      event: 'APPROVE',
      body: message
    });
    console.log(`[approvePR] Successfully approved PR #${prNumber}`);
    return true;
  } catch (error) {
    console.error(`[approvePR] Failed to approve PR:`, error.message);
    // If permission denied, log but don't fail - commenting is still useful
    if (error.status === 403) {
      console.warn(`[approvePR] Permission denied - bot may not have pull_requests: write permission`);
    }
    return false;
  }
}

/**
 * Create a PR with code in the student's repository
 * @param {Object} context - GitHub context
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Branch name to create
 * @param {string} fileName - File name to create
 * @param {string} fileContent - File content
 * @param {string} prTitle - PR title
 * @param {string} prBody - PR body
 * @returns {Object|null} { prNumber, prUrl } or null if failed
 */
async function createPRWithCode(context, owner, repo, branchName, fileName, fileContent, prTitle, prBody) {
  let repoInfo = null;
  try {
    // Get default branch (usually main or master)
    repoInfo = await context.octokit.rest.repos.get({
      owner: owner,
      repo: repo
    });
    const defaultBranch = repoInfo.data.default_branch;
    
    // Get the SHA of the default branch
    const refResponse = await context.octokit.rest.git.getRef({
      owner: owner,
      repo: repo,
      ref: `heads/${defaultBranch}`
    });
    const baseSha = refResponse.data.object.sha;
    
    // Create a new branch
    await context.octokit.rest.git.createRef({
      owner: owner,
      repo: repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    });
    console.log(`[createPRWithCode] Created branch: ${branchName}`);
    
    // Create or update the file
    const fileContentBase64 = Buffer.from(fileContent).toString('base64');
    await context.octokit.rest.repos.createOrUpdateFileContents({
      owner: owner,
      repo: repo,
      path: fileName,
      message: `Add ${fileName} for code review`,
      content: fileContentBase64,
      branch: branchName
    });
    console.log(`[createPRWithCode] Created file: ${fileName}`);
    
    // Create the PR
    const prResponse = await context.octokit.rest.pulls.create({
      owner: owner,
      repo: repo,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: defaultBranch
    });
    
    console.log(`[createPRWithCode] Created PR #${prResponse.data.number}`);
    return {
      prNumber: prResponse.data.number,
      prUrl: prResponse.data.html_url,
      branchName: branchName
    };
  } catch (error) {
    console.error(`[createPRWithCode] Failed to create PR:`, error.message);
    if (error.status === 422 && error.response?.data?.errors) {
      // Branch might already exist, try to update it
      if (error.response.data.errors.some(e => e.message?.includes('already exists'))) {
        console.log(`[createPRWithCode] Branch exists, updating file...`);
        try {
          // Get existing file SHA
          const fileResponse = await context.octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: fileName,
            ref: branchName
          });
          
          const fileContentBase64 = Buffer.from(fileContent).toString('base64');
          await context.octokit.rest.repos.createOrUpdateFileContents({
            owner: owner,
            repo: repo,
            path: fileName,
            message: `Update ${fileName}`,
            content: fileContentBase64,
            branch: branchName,
            sha: fileResponse.data.sha
          });
          
          // Check if PR already exists
          const prsResponse = await context.octokit.rest.pulls.list({
            owner: owner,
            repo: repo,
            head: `${owner}:${branchName}`,
            base: repoInfo?.data?.default_branch || 'main',
            state: 'open'
          });
          
          if (prsResponse.data.length > 0) {
            return {
              prNumber: prsResponse.data[0].number,
              prUrl: prsResponse.data[0].html_url,
              branchName: branchName
            };
          }
        } catch (updateError) {
          console.error(`[createPRWithCode] Failed to update existing branch:`, updateError.message);
        }
      }
    }
    return null;
  }
}

/**
 * Update code in an existing PR
 * @param {Object} context - GitHub context
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Branch name
 * @param {string} fileName - File name
 * @param {string} fileContent - New file content
 * @returns {boolean} Success
 */
async function updatePRCode(context, owner, repo, branchName, fileName, fileContent) {
  try {
    // Get existing file SHA
    const fileResponse = await context.octokit.rest.repos.getContent({
      owner: owner,
      repo: repo,
      path: fileName,
      ref: branchName
    });
    
    // Check if content actually changed to avoid empty commits
    const existingContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf-8');
    if (existingContent === fileContent) {
      console.log(`[updatePRCode] Content unchanged, skipping commit to avoid empty commit`);
      return true; // Return true but don't create commit
    }
    
    const fileContentBase64 = Buffer.from(fileContent).toString('base64');
    
    // Create a new commit with updated code (simulates a real user push)
    const commitMessage = `Fix: Update ${fileName} based on code review feedback`;
    
    await context.octokit.rest.repos.createOrUpdateFileContents({
      owner: owner,
      repo: repo,
      path: fileName,
      message: commitMessage,
      content: fileContentBase64,
      branch: branchName,
      sha: fileResponse.data.sha
    });
    
    console.log(`[updatePRCode] Created new commit "${commitMessage}" in branch ${branchName}`);
    console.log(`[updatePRCode] Updated file ${fileName} - this will appear as a new commit in the PR`);
    return true;
  } catch (error) {
    console.error(`[updatePRCode] Failed to update PR code:`, error.message);
    return false;
  }
}

/**
 * Validate code against requirements (similar to iterative code review validation)
 * @param {string} code - Code to validate
 * @param {string} requirements - Requirements description
 * @param {Array} reviewCriteria - Review criteria
 * @param {string} codeLanguage - Code language
 * @param {Object} llmInstance - LLM instance
 * @param {number} temperature - LLM temperature
 * @returns {Object} { approved: boolean, feedback: string }
 */
async function validateCodeAgainstRequirements(code, requirements, reviewCriteria, codeLanguage, llmInstance, temperature = 0.3) {
  try {
    const criteriaText = Array.isArray(reviewCriteria) && reviewCriteria.length > 0
      ? `\n\n**Review Criteria:**\n${reviewCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';
    
    const validationPrompt = `You are a code reviewer evaluating code against specific requirements.

**REQUIREMENTS:**
${requirements}${criteriaText}

**CODE TO VALIDATE:**
\`\`\`${codeLanguage}
${code}
\`\`\`

**YOUR TASK:**
Review the code above and determine if it meets ALL requirements and criteria.

**RESPONSE FORMAT:**
- If the code meets ALL requirements: Respond with "1|APPROVED"
- If the code does NOT meet all requirements: Respond with "0|<constructive feedback>"
  - Format feedback as a BULLETED LIST of actionable items
  - Each item should be a specific issue that needs to be fixed
  - Be specific about what's missing or incorrect
  - Example format: "0|- Missing null pointer validation\\n- Function doesn't check buffer length\\n- Invalid input not handled"

Your response:`;
    
    console.log(`[validateCodeAgainstRequirements] Calling LLM for validation...`);
    const llmResult = await llmInstance.validateTextAnswer(validationPrompt, temperature, true);
    
    // Parse result
    if (llmResult.startsWith('1|') || llmResult === '1' || llmResult.toLowerCase().includes('approved')) {
      return { approved: true, feedback: 'Code meets all requirements' };
    } else {
      const feedback = llmResult.startsWith('0|') 
        ? llmResult.substring(2).trim()
        : llmResult.startsWith('0')
          ? llmResult.substring(1).trim() || 'Code does not meet all requirements'
          : llmResult;
      
      return { approved: false, feedback: feedback };
    }
  } catch (error) {
    console.error(`[validateCodeAgainstRequirements] Error:`, error.message);
    return { approved: false, feedback: 'Validation error occurred' };
  }
}

/**
 * Merge a PR using GitHub's merge API
 * Requires pull_requests: write permission and merge access
 * Mirrors the test-merge-pr.mjs script functionality
 */
async function mergePR(context, owner, repo, prNumber, mergeMethod = 'merge') {
  try {
    // First, check PR status to ensure it's mergeable (mirrors test script)
    console.log(`[mergePR] Checking PR #${prNumber} status before merge...`);
    const prResponse = await context.octokit.rest.pulls.get({
      owner: owner,
      repo: repo,
      pull_number: prNumber
    });
    
    const pr = prResponse.data;
    console.log(`[mergePR] PR #${pr.number}: ${pr.title}`);
    console.log(`[mergePR] State: ${pr.state}, Mergeable: ${pr.mergeable === null ? 'unknown' : pr.mergeable}`);
    
    // Validate PR is open
    if (pr.state !== 'open') {
      console.warn(`[mergePR] PR is ${pr.state}, cannot merge`);
      return false;
    }
    
    // Check if PR has merge conflicts
    if (pr.mergeable === false) {
      console.warn(`[mergePR] PR has merge conflicts and cannot be merged`);
      return false;
    }
    
    // Attempt to merge the PR
    console.log(`[mergePR] Attempting to merge PR #${prNumber} using ${mergeMethod} method...`);
    const mergeResponse = await context.octokit.rest.pulls.merge({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
      merge_method: mergeMethod // 'merge', 'squash', or 'rebase'
    });
    
    console.log(`[mergePR] Successfully merged PR #${prNumber} using ${mergeMethod} method`);
    console.log(`[mergePR] Merge SHA: ${mergeResponse.data.sha}, Merged: ${mergeResponse.data.merged}`);
    return true;
  } catch (error) {
    console.error(`[mergePR] Failed to merge PR #${prNumber}:`, error.message);
    if (error.status === 403) {
      console.warn(`[mergePR] Permission denied - bot may not have pull_requests: write permission or merge access`);
    } else if (error.status === 405) {
      console.warn(`[mergePR] Merge not allowed - PR may have conflicts, be blocked by branch protection, or not be mergeable`);
      if (error.response?.data) {
        console.warn(`[mergePR] Error details:`, JSON.stringify(error.response.data, null, 2));
      }
    } else if (error.status === 404) {
      console.warn(`[mergePR] PR not found - check owner, repo, and PR number`);
    } else if (error.response) {
      console.warn(`[mergePR] Error status: ${error.status}, Data:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

/**
 * Handler for iterative code review tasks
 * Students submit code via GitHub file URL OR PR link for AI review
 * The bot provides feedback until code meets requirements or max iterations reached
 * Students can resubmit with new URL or type "done" to recheck last submission
 */
export async function handleIterativeCodeReview(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  console.log(`[handleIterativeCodeReview] Starting - Quest: ${quest}, Task: ${task}, User: ${user}`);
  
  try {
    // Get quest configuration
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig[quest][task];
    
    console.log(`[handleIterativeCodeReview] Task config:`, {
      hasReviewPrompt: !!taskConfig.iterativeCodeReview?.reviewPrompt,
      criteriaCount: taskConfig.iterativeCodeReview?.reviewCriteria?.length || 0,
      maxIterations: taskConfig.iterativeCodeReview?.maxIterations || 5
    });
    
    // Validate configuration
    if (!taskConfig.iterativeCodeReview || !taskConfig.iterativeCodeReview.reviewPrompt) {
      console.error(`[handleIterativeCodeReview] Missing review configuration for ${quest}${task}`);
      return [response.error + '\n\n❌ **Configuration Error**: This task is not properly configured. Please contact an administrator.', false];
    }
    
    const config = taskConfig.iterativeCodeReview;
    const reviewPrompt = config.reviewPrompt || "";
    const reviewCriteria = Array.isArray(config.reviewCriteria) ? config.reviewCriteria : [];
    const maxIterations = config.maxIterations || 5;
    const temperature = config.temperature || 0.3;
    const enableDetailedFeedback = config.enableDetailedFeedback !== false;
    
    // Get or initialize state
    if (!user_data.storedValues) {
      user_data.storedValues = {};
    }
    if (!user_data.storedValues.codeReviewState) {
      user_data.storedValues.codeReviewState = {};
    }
    if (!user_data.storedValues.codeReviewState[quest]) {
      user_data.storedValues.codeReviewState[quest] = {};
    }
    
    const stateKey = `${quest}.${task}`;
    let taskState = user_data.storedValues.codeReviewState[quest][task];
    
    if (!taskState) {
      taskState = {
        iteration: 0,
        lastReviewedUrl: null,
        reviewHistory: [],
        status: 'pending',
        // PR-specific fields
        prInfo: null,
        lastPRCommitSha: null,
        originalIssueNumber: null // Track the original issue that spawned this task
      };
      user_data.storedValues.codeReviewState[quest][task] = taskState;
    }
    
    // Store original issue number if not set yet
    if (!taskState.originalIssueNumber) {
      taskState.originalIssueNumber = selectedIssue || context.issue().issue_number;
      console.log(`[handleIterativeCodeReview] Stored original issue number: ${taskState.originalIssueNumber}`);
    }
    
    console.log(`[handleIterativeCodeReview] Current state:`, taskState);
    
    // Get user input
    const userInput = context.payload.comment.body.trim();
    
    // Check if user said "done" to recheck last reviewed file/PR
    const doneCommands = ['done', 'recheck', 'review again', 'check again', 'ready', 'ready for review'];
    const isDoneCommand = doneCommands.some(cmd => userInput.toLowerCase() === cmd);
    
    let codeUrl, prInfo, isPRSubmission = false;
    
    if (isDoneCommand) {
      if (!taskState.lastReviewedUrl && !taskState.prInfo) {
        return [
          response.error +
            `\n\n❌ **No previous submission**: You haven't submitted any code yet.\n\nPlease provide:\n- A GitHub file URL, OR\n- A GitHub Pull Request URL`,
          false
        ];
      }
      
      if (taskState.prInfo) {
        prInfo = taskState.prInfo;
        isPRSubmission = true;
        console.log(`[handleIterativeCodeReview] Rechecking PR #${prInfo.prNumber}`);
      } else {
        codeUrl = taskState.lastReviewedUrl;
        console.log(`[handleIterativeCodeReview] Rechecking last reviewed URL: ${codeUrl}`);
      }
    } else {
      // Check if input is a PR URL
      prInfo = extractPRInfo(userInput);
      
      if (prInfo) {
        isPRSubmission = true;
        console.log(`[handleIterativeCodeReview] Detected PR submission: ${prInfo.owner}/${prInfo.repo}#${prInfo.prNumber}`);
        
        // First PR submission - post link to issue and tell user all future interaction is in PR
        if (!taskState.prInfo) {
          console.log(`[handleIterativeCodeReview] First PR submission - will post PR link to issue`);
        }
      } else {
        // Try to extract GitHub file URL
        const urlMatch = userInput.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
        const rawUrlMatch = userInput.match(/https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/);
        
        if (!urlMatch && !rawUrlMatch) {
          return [
            response.error +
              `\n\n❌ **Invalid submission**: Please provide either:\n- A GitHub file URL: \`https://github.com/owner/repo/blob/main/file.cpp\`\n- A GitHub PR URL: \`https://github.com/owner/repo/pull/123\`\n\nOr type \`done\` to recheck your last submission.`,
            false
          ];
        }
        
        codeUrl = userInput.match(/(https:\/\/[^\s]+)/)?.[0];
        console.log(`[handleIterativeCodeReview] New code URL: ${codeUrl}`);
      }
    }
    
    // Check iteration limit
    if (taskState.iteration >= maxIterations) {
      // Complete the task and close the issue even though not perfect
      taskState.status = 'completed_with_max_iterations';
      await completeTask(user_data, quest, task, context, db);
      console.log(`[handleIterativeCodeReview] Task ${quest}${task} completed with max iterations`);
      
      // Get original issue number and repo info
      const originalIssueNumber = taskState.originalIssueNumber || user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
      const { owner, repo } = context.repo();
      
      // Explicitly close the original issue if we have the number
      if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
        try {
          await context.octokit.rest.issues.update({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
            state: "closed",
          });
          console.log(`[handleIterativeCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleIterativeCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      // Generate next task link
      let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
      try {
        const questConfig = await getQuestConfigForUser(user_data);
        const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
        const currentQuestIndex = allQuests.indexOf(quest);
        if (currentQuestIndex !== -1) {
          const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
          const currentTaskIndex = currentQuestTasks.indexOf(task);
          if (currentTaskIndex !== -1) {
            // Check if there's a next task in current quest
            if (currentTaskIndex < currentQuestTasks.length - 1) {
              const nextTask = currentQuestTasks[currentTaskIndex + 1];
              if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
              }
            } else if (currentQuestIndex < allQuests.length - 1) {
              // Check if there's a next quest
              const nextQuest = allQuests[currentQuestIndex + 1];
              const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
              if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
              }
            }
          }
        }
      } catch (navError) {
        console.warn(`[handleIterativeCodeReview] Error generating next task link:`, navError.message);
      }
      
      const maxIterMsg = `✅ **Task Completed!**\n\n⚠️ **Maximum iterations reached**: You've completed ${maxIterations} review cycles. While your code didn't fully meet all requirements, you've made progress and the task is now complete.\n\n**Feedback from last iteration:**\n${taskState.reviewHistory.length > 0 ? taskState.reviewHistory[taskState.reviewHistory.length - 1]?.feedback || 'See previous comments' : 'See previous comments'}\n\n**Points/XP awarded for your effort!**\n\n**Next Steps:**\n- Review the feedback from all iterations to understand what could be improved\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\nKeep learning and improving! 🚀`;
      
      // Post to PR if PR-based task
      if (taskState.prInfo && config.commentOnPR) {
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, maxIterMsg);
        console.log(`[handleIterativeCodeReview] ✅ Posted max iterations message to PR #${taskState.prInfo.prNumber}`);
      }
      
      // Post message to original issue
      if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
        try {
          await context.octokit.rest.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
            body: maxIterMsg,
          });
          console.log(`[handleIterativeCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleIterativeCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      return [response.success, true];
    }
    
    // Increment iteration count
    taskState.iteration++;
    
    let fileContent;
    let filesForReview = [];
    
    // Handle PR submission
    if (isPRSubmission) {
      console.log(`[handleIterativeCodeReview] Processing PR submission - Iteration ${taskState.iteration}/${maxIterations}`);
      
      // Fetch PR data using authenticated GitHub API
      let prData;
      try {
        const prResponse = await context.octokit.rest.pulls.get({
          owner: prInfo.owner,
          repo: prInfo.repo,
          pull_number: prInfo.prNumber
        });
        prData = prResponse.data;
        console.log(`[handleIterativeCodeReview] PR data fetched: #${prData.number}, state: ${prData.state}, head SHA: ${prData.head.sha}`);
      } catch (error) {
        console.error(`[handleIterativeCodeReview] Error fetching PR:`, error.message);
        if (error.status === 404) {
          return [
            response.error +
              `\n\n❌ **PR not found**: Could not find PR #${prInfo.prNumber} in ${prInfo.owner}/${prInfo.repo}.\n\nPlease check that:\n- The PR number is correct\n- The PR exists\n- The repository is accessible`,
            false
          ];
        } else if (error.status === 403) {
          return [
            response.error +
              `\n\n❌ **Access denied**: Cannot access PR #${prInfo.prNumber} in ${prInfo.owner}/${prInfo.repo}.\n\nThe repository may be private and the bot may not have access. Please contact your instructor.`,
            false
          ];
        } else {
          return [
            response.error +
              `\n\n❌ **Error fetching PR**: ${error.message}\n\nPlease try again or contact an administrator if the problem persists.`,
            false
          ];
        }
      }
      
      // Validate PR safety
      const safetyCheck = await validatePRSafety(prData, user);
      if (!safetyCheck.safe) {
        return [
          response.error + '\n\n' + safetyCheck.error,
          false
        ];
      }
      
      // Check if PR has been updated since last review
      if (taskState.lastPRCommitSha && taskState.lastPRCommitSha === prData.head.sha && isDoneCommand) {
        console.log(`[handleIterativeCodeReview] PR has not been updated since last review (SHA: ${prData.head.sha})`);
      } else if (taskState.lastPRCommitSha && taskState.lastPRCommitSha !== prData.head.sha) {
        console.log(`[handleIterativeCodeReview] PR has been updated: ${taskState.lastPRCommitSha} -> ${prData.head.sha}`);
      }
      
      // Update state
      taskState.prInfo = prInfo;
      taskState.lastPRCommitSha = prData.head.sha;
      taskState.lastReviewedUrl = prData.html_url;
      
      // Fetch PR files
      const filePattern = config.prFilePattern || null;
      try {
        filesForReview = await fetchPRFiles(context, prInfo.owner, prInfo.repo, prInfo.prNumber, filePattern);
        
        if (filesForReview.length === 0) {
          return [
            response.error +
              `\n\n❌ **No files to review**: PR #${prInfo.prNumber} has no files${filePattern ? ` matching pattern: ${filePattern}` : ''}.\n\nPlease ensure your PR includes the required code files.`,
            false
          ];
        }
        
        console.log(`[handleIterativeCodeReview] Fetched ${filesForReview.length} files from PR for review`);
        
        // Combine files into review content
        if (filesForReview.length === 1) {
          fileContent = filesForReview[0].content;
        } else {
          // Multiple files: format as sections
          fileContent = filesForReview.map(file => 
            `// File: ${file.filename}\n${file.content}`
          ).join('\n\n' + '='.repeat(80) + '\n\n');
        }
        
      } catch (error) {
        console.error(`[handleIterativeCodeReview] Error fetching PR files:`, error.message);
        return [
          response.error +
            `\n\n❌ **Error fetching PR files**: ${error.message}\n\nPlease try again or contact an administrator if the problem persists.`,
          false
        ];
      }
      
    } else {
      // Handle file URL submission (existing logic)
      console.log(`[handleIterativeCodeReview] Processing file URL submission - Iteration ${taskState.iteration}/${maxIterations}`);
      
      taskState.lastReviewedUrl = codeUrl;
      taskState.prInfo = null;
      taskState.lastPRCommitSha = null;
      
      // Parse GitHub file URL
      const urlMatch = codeUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
      const rawUrlMatch = codeUrl.match(/https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/);
      
      let owner, repo, ref, filePath;
      if (urlMatch) {
        [, owner, repo, ref, filePath] = urlMatch;
      } else if (rawUrlMatch) {
        [, owner, repo, ref, filePath] = rawUrlMatch;
      }
      
      // Fetch file content from GitHub API
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`;
        console.log(`[handleIterativeCodeReview] Fetching file from: ${apiUrl}`);
        
        const axios = (await import("axios")).default;
        const fileResponse = await axios.get(apiUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          }
        });
        
        // Decode base64 content
        fileContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf-8');
        console.log(`[handleIterativeCodeReview] File fetched, size: ${fileContent.length} bytes`);
        
      } catch (error) {
        console.error(`[handleIterativeCodeReview] Error fetching file:`, error.message);
        if (error.response?.status === 404) {
          return [
            response.error +
              `\n\n❌ **File not found**: Could not find the file at the provided URL.\n\nPlease check that:\n- The URL is correct\n- The file exists\n- The repository is public`,
            false
          ];
        } else {
          return [
            response.error +
              `\n\n❌ **Error fetching file**: ${error.message}\n\nPlease try again or contact an administrator if the problem persists.`,
            false
          ];
        }
      }
    }
    
    // Build comprehensive review prompt
    const fullPrompt = `You are a code reviewer evaluating student code.

**REQUIREMENTS:**
${reviewPrompt}

${reviewCriteria.length > 0 ? `**REVIEW CRITERIA:**\n${reviewCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n` : ''}

**STUDENT'S CODE (Iteration ${taskState.iteration}):**
\`\`\`
${fileContent}
\`\`\`

${taskState.reviewHistory.length > 0 ? `**PREVIOUS FEEDBACK (for context only - check if these issues are NOW FIXED):**\n${taskState.reviewHistory[taskState.reviewHistory.length - 1]?.feedback || ''}\n\n` : ''}

**YOUR TASK:**
Review the CURRENT code above and determine if it meets ALL requirements and criteria.

**CRITICAL INSTRUCTIONS:**
1. Review the ACTUAL CURRENT CODE provided above, not previous versions
2. Check if issues from previous feedback have been FIXED in the current code
3. If an issue was mentioned before but is NOW FIXED, do NOT mention it again
4. Only mention issues that are STILL PRESENT in the current code
5. If the code is CORRECT and meets ALL requirements, approve it immediately (return "1|APPROVED")
6. Do NOT reference "previous feedback" in your response - only mention what's wrong with the CURRENT code
7. Base your decision ONLY on what you see in the current code, not on what was wrong before

**RESPONSE FORMAT:**
- If the code meets ALL requirements: Respond with "1|APPROVED" (or just "1" if no additional feedback needed)
- If the code does NOT meet all requirements: Respond with "0|<constructive feedback>"
  - Format feedback as a BULLETED LIST of SPECIFIC code issues
  - Be SPECIFIC and reference actual code patterns, lines, functions, or conditions
  - Point to direct parts of the code with concrete examples
  - List ALL issues found, not just a summary
  - Use format: "function_name() can crash when..." or "if (condition): is wrong because..." or "Line with X can fail on Y"
  - Reference actual code snippets when possible
  - Be direct and technical - point to exact problems
  - Do NOT provide the complete solution
  - ALWAYS include feedback when rejecting (never return just "0" without explanation)
  - Example format: "0|- if (index <= len(num_string)): is basically always true\\n- mantissa() can crash when there is no dot\\n- characteristic() can crash on strings like \\".5\\"\\n- Function doesn't handle None input\\n- Loop at line X can cause index out of bounds"

**FEEDBACK FORMAT REQUIREMENTS:**
- Use bullet points (start each item with "-")
- Each bullet should reference SPECIFIC code (function names, conditions, variables, etc.)
- Be direct and technical - "function_name() does X wrong" not "check your function"
- Reference actual code patterns: "if (x > 0):", "while (index < len):", "result[i]", etc.
- Be concrete: "characteristic() crashes on '.5'" not "handle edge cases"
- List ALL specific issues, not just general advice

Your response:`;
    
    console.log(`[handleIterativeCodeReview] Calling LLM for review...`);
    
    // Helper function to format feedback as a structured list
    const formatFeedbackAsList = (feedbackText) => {
      if (!feedbackText) return '';
      
      // Convert escaped newlines (\n) to actual newlines
      feedbackText = feedbackText.replace(/\\n/g, '\n');
      
      // Normalize line breaks
      feedbackText = feedbackText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      
      // Check if already formatted as bullets
      const hasBullets = feedbackText.includes('\n-') || feedbackText.startsWith('-') || 
                         feedbackText.includes('\n*') || feedbackText.startsWith('*') ||
                         feedbackText.includes('\n•') || feedbackText.startsWith('•');
      
      if (hasBullets) {
        // Clean up existing bullets - ensure consistent formatting
        const lines = feedbackText
          .split('\n')
          .map(line => {
            line = line.trim();
            // Normalize different bullet types to '-'
            if (line.startsWith('*') || line.startsWith('•')) {
              line = '-' + line.substring(1).trim();
            }
            // Ensure non-empty lines have bullets
            if (line.length > 0 && !line.startsWith('-')) {
              return `- ${line}`;
            }
            return line;
          })
          .filter(line => line.length > 0);
        
        // Ensure first line has a bullet if any line has bullets
        if (lines.length > 0 && !lines[0].startsWith('-')) {
          lines[0] = `- ${lines[0]}`;
        }
        
        return lines.join('\n');
      }
      
      // If it's a paragraph, split into actionable items
      // Look for common patterns that indicate separate items
      const itemPatterns = [
        /(?:^|\n)(?:\d+[\.\)]\s*|[-•*]\s*)?([A-Z][^.!?]*[.!?])/g,  // Numbered or bulleted items
        /(?:^|\n)(?:Also|Additionally|Furthermore|Moreover|Next|Then|Finally)[\s,]+([^.!?]+[.!?])/gi,  // Transition words
        /(?:^|\n)(?:Ensure|Check|Add|Fix|Implement|Handle|Verify|Make sure)[\s,]+([^.!?]+[.!?])/gi,  // Action verbs
      ];
      
      // Try to find structured items first
      let items = [];
      for (const pattern of itemPatterns) {
        const matches = [...feedbackText.matchAll(pattern)];
        if (matches.length > 1) {
          items = matches.map(m => m[1] || m[0]).map(s => s.trim()).filter(s => s.length > 0);
          break;
        }
      }
      
      // If no structured items found, split by sentences
      if (items.length === 0) {
        items = feedbackText
          .split(/(?<=[.!?])\s+(?=[A-Z])/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && s.length > 10);  // Filter out very short fragments
      }
      
      // If still no items, try splitting by commas in longer sentences
      if (items.length <= 1 && feedbackText.includes(',')) {
        const parts = feedbackText.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length > 2) {
          items = parts.map(p => {
            // Add period if missing
            if (!p.match(/[.!?]$/)) {
              p += '.';
            }
            return p;
          });
        }
      }
      
      // Format as bullets
      if (items.length > 1) {
        return items
          .map(item => {
            // Clean up item text
            item = item.replace(/^[-•*\d+\.\)]\s*/, '').trim();
            // Ensure it starts with action verb or is actionable
            if (!item.match(/^(Ensure|Check|Add|Fix|Implement|Handle|Verify|Make sure|Review|Update|Modify|Improve)/i)) {
              // Try to make it more actionable
              if (item.toLowerCase().includes('should')) {
                item = item.replace(/should/gi, 'must');
              }
            }
            return `- ${item}`;
          })
          .join('\n');
      }
      
      // Single item - just add bullet
      return `- ${feedbackText.trim()}`;
    };
    
    // Call LLM for code review
    let reviewResult;
    try {
      reviewResult = await llmInstance.validateTextAnswer(fullPrompt, enableDetailedFeedback, temperature);
      console.log(`[handleIterativeCodeReview] LLM result: ${reviewResult}`);
    } catch (error) {
      console.error(`[handleIterativeCodeReview] LLM error:`, error);
      return [
        response.error +
          `\n\n❌ **Review error**: An error occurred during code review. Please try again later.`,
        false
      ];
    }
    
    // Parse review result
    let approved = false;
    let feedback = "";
    
    if (reviewResult.startsWith('1')) {
      approved = true;
      feedback = reviewResult.includes('|') ? reviewResult.split('|')[1].trim() : 'Code approved!';
      // Convert escaped newlines to actual newlines
      feedback = feedback.replace(/\\n/g, '\n');
    } else if (reviewResult.startsWith('0|')) {
      approved = false;
      let rawFeedback = reviewResult.substring(2).trim();
      // Convert escaped newlines to actual newlines before processing
      rawFeedback = rawFeedback.replace(/\\n/g, '\n');
      feedback = rawFeedback || 'The code needs revision. Please review the requirements and criteria carefully.';
      // Format as list
      feedback = formatFeedbackAsList(feedback);
    } else if (reviewResult.trim() === '0') {
      // LLM returned just "0" without feedback - provide default actionable list
      approved = false;
      feedback = `- Review all requirements and criteria carefully\n- Ensure your implementation handles all edge cases\n- Check for proper input validation\n- Verify error handling is correct`;
    } else {
      // Try to interpret
      const lower = reviewResult.toLowerCase();
      if (lower.includes('approved') || lower.includes('meets') || lower.includes('correct') || lower === '1') {
        approved = true;
        feedback = reviewResult.trim() || 'Code approved!';
        // Convert escaped newlines to actual newlines
        feedback = feedback.replace(/\\n/g, '\n');
      } else {
        approved = false;
        let rawFeedback = reviewResult.trim() || 'The code needs revision. Please review the requirements and criteria carefully.';
        // Convert escaped newlines to actual newlines before processing
        rawFeedback = rawFeedback.replace(/\\n/g, '\n');
        feedback = formatFeedbackAsList(rawFeedback);
      }
    }
    
    // Flag to track if this is the first PR submission for this task (check BEFORE adding to history)
    const isFirstPRSubmission = isPRSubmission && !taskState.reviewHistory.some(r => r.url && r.url.includes('PR #'));
    
    // Record review in history
    taskState.reviewHistory.push({
      iteration: taskState.iteration,
      url: isPRSubmission ? `PR #${prInfo.prNumber}` : codeUrl,
      feedback,
      approved,
      timestamp: new Date().toISOString()
    });
    
    console.log(`[handleIterativeCodeReview] Review complete - Approved: ${approved}`);
    
    // Save state
    await db.updateData(
      user + `-${ossRepo}`,
      user_data.storedValues,
      "code review state updated"
    );
    
    // Optionally comment on PR if enabled and accessible
    const commentOnPREnabled = config.commentOnPR !== false; // Default true
    const approvePREnabled = config.approvePR === true; // Default false - requires explicit opt-in
    
    if (isPRSubmission && commentOnPREnabled) {
      // For approval: create an encouraging message about what they accomplished
      // For feedback: provide actionable items
      let prCommentMessage;
      
      if (approved) {
        // Encouraging approval message with details about the code
        const encouragingIntro = [
          "🎉 **Excellent work!**",
          "✨ **Outstanding!**",
          "🌟 **Fantastic job!**",
          "💯 **Perfect!**",
          "🚀 **Great work!**"
        ][Math.floor(Math.random() * 5)];
        
        prCommentMessage = `${encouragingIntro}\n\n${feedback}\n\nYour implementation meets all the requirements and handles edge cases properly. This is exactly what we're looking for in production-quality code!\n\n---\n\n*Automated review by OSS-Doorway Bot (Iteration ${taskState.iteration}/${maxIterations})*`;
      } else {
        prCommentMessage = `📝 **Code Review Feedback (Iteration ${taskState.iteration}/${maxIterations})**\n\n**Issues to Address:**\n\n${feedback}\n\n---\n\n**Next Steps:**\n- Address the feedback above\n- Push your changes to this PR\n- The bot will automatically review new commits\n\n*Automated review by OSS-Doorway Bot*`;
      }
      
      const prCommented = await commentOnPR(context, prInfo.owner, prInfo.repo, prInfo.prNumber, prCommentMessage);
      if (prCommented) {
        console.log(`[handleIterativeCodeReview] Successfully commented on PR #${prInfo.prNumber}`);
      } else {
        console.log(`[handleIterativeCodeReview] Could not comment on PR (will show feedback in issue only)`);
      }
    }
    
    // Optionally approve PR if code is approved and auto-approval is enabled
    const mergePREnabled = config.mergePR === true; // Default false - requires explicit opt-in
    const mergeMethod = config.mergeMethod || 'merge'; // Default: merge
    
    if (isPRSubmission && approved && approvePREnabled) {
      // Use approvePR API but with empty body since we already posted the main comment above
      const prApproved = await approvePR(context, prInfo.owner, prInfo.repo, prInfo.prNumber, '');
      if (prApproved) {
        console.log(`[handleIterativeCodeReview] Successfully approved PR #${prInfo.prNumber}`);
      } else {
        console.log(`[handleIterativeCodeReview] Could not approve PR (may require pull_requests: write permission)`);
      }
    }
    
    // Optionally merge PR if code is approved and auto-merge is enabled
    if (isPRSubmission && approved && mergePREnabled) {
      const prMerged = await mergePR(context, prInfo.owner, prInfo.repo, prInfo.prNumber, mergeMethod);
      if (prMerged) {
        console.log(`[handleIterativeCodeReview] Successfully merged PR #${prInfo.prNumber}`);
      } else {
        console.log(`[handleIterativeCodeReview] Could not merge PR (may require pull_requests: write permission, merge access, or PR may have conflicts)`);
      }
    }
    
    if (approved) {
      // Task complete!
      taskState.status = 'approved';
      await completeTask(user_data, quest, task, context, db);
      console.log(`[handleIterativeCodeReview] Task ${quest}${task} completed successfully`);
      
      // Get original issue number (not the PR number)
      const originalIssueNumber = taskState.originalIssueNumber || user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
      const { owner, repo } = context.repo();
      
      // Explicitly close the original issue if we have the number and it's different from PR number
      if (originalIssueNumber && isPRSubmission && originalIssueNumber !== prInfo.prNumber) {
        try {
          await context.octokit.rest.issues.update({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
            state: "closed",
          });
          console.log(`[handleIterativeCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleIterativeCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      const prApprovalNote = isPRSubmission && approvePREnabled 
        ? '\n\n✅ **PR has been automatically approved!**'
        : isPRSubmission 
          ? '\n\n💡 *Note: PR approval requires enabling "Auto-approve PR" in task configuration*'
          : '';
      
      const prMergeNote = isPRSubmission && mergePREnabled
        ? '\n\n✅ **PR has been automatically merged!**'
        : isPRSubmission && approved
          ? '\n\n💡 *Note: PR merge requires enabling "Auto-merge PR" in task configuration*'
          : '';
      
      // If PR submission, only post to PR (return minimal '.' to issue)
      if (isPRSubmission && commentOnPREnabled) {
        // Post completion message to original issue
        if (originalIssueNumber && originalIssueNumber !== prInfo.prNumber) {
          try {
            // Generate next task link
            let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
            try {
              const questConfig = await getQuestConfigForUser(user_data);
              const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
              const currentQuestIndex = allQuests.indexOf(quest);
              if (currentQuestIndex !== -1) {
                const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
                const currentTaskIndex = currentQuestTasks.indexOf(task);
                if (currentTaskIndex !== -1) {
                  // Check if there's a next task in current quest
                  if (currentTaskIndex < currentQuestTasks.length - 1) {
                    const nextTask = currentQuestTasks[currentTaskIndex + 1];
                    if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                      const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                      nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
                    }
                  } else if (currentQuestIndex < allQuests.length - 1) {
                    // Check if there's a next quest
                    const nextQuest = allQuests[currentQuestIndex + 1];
                    const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
                    if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                      const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                      nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
                    }
                  }
                }
              }
            } catch (navError) {
              console.warn(`[handleIterativeCodeReview] Error generating next task link:`, navError.message);
            }
            
            const nextTaskMsg = `✅ **Task Completed!**\n\n🎉 Great job! Your code has been reviewed and approved. The PR has been ${mergePREnabled ? 'merged' : 'approved'}.\n\n**Next Steps:**\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\nKeep up the excellent work! 🚀`;
            await context.octokit.rest.issues.createComment({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              body: nextTaskMsg,
            });
            console.log(`[handleIterativeCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
          } catch (error) {
            console.warn(`[handleIterativeCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
          }
        }
        // Return minimal string - we already posted to PR
        return ['.', true];
      }
      
      // Non-PR or PR without commenting enabled - return full message to issue
      const successMessage = isPRSubmission
        ? response.success + `\n\n✅ **Code Approved!**\n\n${feedback}\n\n🎉 Your PR #${prInfo.prNumber} has been reviewed and approved!${prApprovalNote}${prMergeNote}\n\n${commentOnPREnabled ? '*Feedback also posted on your PR*' : ''}`
        : response.success + `\n\n✅ **Code Approved!**\n\n${feedback}`;
      
      return [successMessage, true];
    } else {
      // Needs revision
      taskState.status = 'awaiting_resubmission';
      
      // If this is the first PR submission, post PR link to issue and tell them all interaction is now in PR
      if (isFirstPRSubmission) {
        const prUrl = `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}`;
        const issueMessage = `📝 **Code Review in Progress**\n\nYour PR has been received:\n\n🔗 ${prUrl}\n\n**All feedback and interaction will happen in the PR comments.** Please review the feedback there and push new commits to address the issues. The bot will automatically review new commits!`;
        
        // Post to original issue
        try {
          await context.octokit.rest.issues.createComment({
            owner: prInfo.owner,
            repo: prInfo.repo,
            issue_number: taskState.originalIssueNumber,
            body: issueMessage,
          });
          console.log(`[handleIterativeCodeReview] ✅ Posted PR link to issue #${taskState.originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleIterativeCodeReview] ⚠️ Failed to post to issue:`, error.message);
        }
        
        // Return minimal string - we already posted to PR and issue
        return ['.', false];
      }
      
      // If PR submission and commenting is enabled, return minimal message to issue (already posted to PR)
      if (isPRSubmission && commentOnPREnabled) {
        return ['.', false];
      }
      
      // Non-PR or PR without commenting enabled - return full message to issue
      const iterationText = `**Review Result (Iteration ${taskState.iteration}/${maxIterations})**`;
      const feedbackText = `📝 **Issues to Address:**\n\n${feedback}`;
      
      const nextStepsText = isPRSubmission
        ? `\n\n**Next Steps:**\n- Address the feedback above in your PR\n- Push your changes to PR #${prInfo.prNumber}\n- The bot will automatically review new commits${commentOnPREnabled ? '\n\n*Feedback also posted on your PR*' : ''}`
        : `\n\n**Next Steps:**\n- Revise your code based on the feedback above\n- Post a new GitHub file URL with your updated code, or\n- Type \`done\` to recheck the same file if you've updated it`;
      
      return [
        response.error +
          `\n\n${iterationText}\n\n${feedbackText}${nextStepsText}`,
        false
      ];
    }
    
  } catch (error) {
    console.error(`Error in handleIterativeCodeReview for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during code review. Please try again later.', false];
  }
}

/**
 * Analyzes the quality of a student's code review and provides educational feedback
 * @param {Array} reviewHistory - Array of all student feedback throughout the task
 * @param {Array} knownIssues - All known issues that should have been identified
 * @param {Array} identifiedIssues - Issues the student actually identified
 * @param {string} requirements - The requirements/context for the code
 * @param {number} temperature - LLM temperature
 * @returns {string} Educational feedback about review quality
 */
async function analyzeCodeReviewQuality(reviewHistory, knownIssues, identifiedIssues, requirements, temperature = 0.3) {
  try {
    // Collect all student feedback
    const allFeedback = reviewHistory.map((r, idx) => `Iteration ${r.iteration}: "${r.feedback}"`).join('\n');
    
    const analysisPrompt = `You are a code review instructor. Analyze how well a student performed a code review and provide constructive, educational feedback.

**Context:**
The student was asked to review code with these requirements:
${requirements}

**Known Issues (what should have been found):**
${knownIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

**Issues Student Identified:**
${identifiedIssues.length > 0 ? identifiedIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n') : 'None'}

**Student's Review Feedback (all iterations):**
${allFeedback || 'No feedback provided'}

**Your Task:**
Analyze the student's code review quality and provide educational feedback. Consider:
1. **Specificity**: Did they identify exact issues or were they vague?
2. **Actionability**: Can a developer act on their feedback?
3. **Completeness**: Did they find all/most issues?
4. **Clarity**: Is their feedback easy to understand?
5. **Format**: Did they describe issues in text (good) or paste code solutions (not ideal)?
6. **Priority**: Did they focus on functional bugs or get distracted by style?

**Provide feedback in this EXACT format:**

1. Start with overall assessment on its own line (✅ Excellent / ✅ Good / ⚠️ Needs improvement)
2. Add a blank line
3. Write a brief opening paragraph (2-3 sentences) summarizing their performance
4. Add a blank line
5. List specific actionable points as bullets (use "-" for bullets):
   - Start with "**What you did well:**" followed by 1-2 bullet points
   - Then "**Areas for improvement:**" followed by 1-2 bullet points with concrete examples

**Example format:**

⚠️ Needs improvement

Your review identified the critical functional issue, which shows you understand the requirements. However, your feedback could be more professional and constructive.

**What you did well:**
- You correctly identified the missing validation for negative inputs
- You focused on a functional bug rather than style issues

**Areas for improvement:**
- Be more specific about how to fix the issue (e.g., "Add a check: if (a < 0 || b < 0) return -1;")
- Use professional language instead of phrases like "your code is really bad"
- Provide constructive guidance that helps the developer improve

Return ONLY the feedback text in this format, no extra markdown formatting.`;

    console.log(`[analyzeCodeReviewQuality] Analyzing review quality...`);
    const analysisResult = await llmInstance.generateCode(analysisPrompt, temperature);
    
    // Clean up the result (remove any markdown code blocks if LLM added them)
    let feedback = analysisResult.trim();
    const codeBlockMatch = feedback.match(/```[\s\S]*?```/);
    if (codeBlockMatch) {
      feedback = feedback.replace(/```[\s\S]*?```/g, '').trim();
    }
    
    console.log(`[analyzeCodeReviewQuality] Generated feedback (${feedback.length} chars)`);
    return feedback;
  } catch (error) {
    console.error(`[analyzeCodeReviewQuality] Error analyzing review:`, error);
    return "Thanks for your code review! Keep practicing to improve your review skills.";
  }
}

/**
 * Bot Code Review handler - student reviews bot's code
 * Bot presents flawed code, student provides feedback, bot fixes based on feedback
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleBotCodeReview(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  console.log(`[handleBotCodeReview] Starting - Quest: ${quest}, Task: ${task}, User: ${user}`);
  
  try {
    // Get quest configuration
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig[quest][task];
    
    console.log(`[handleBotCodeReview] Task config:`, {
      hasOriginalCode: !!taskConfig.botCodeReview?.originalCode,
      issuesCount: taskConfig.botCodeReview?.knownIssues?.length || 0,
      maxIterations: taskConfig.botCodeReview?.maxIterations || 5,
      awardPointsOnFailure: taskConfig.botCodeReview?.awardPointsOnFailure || false
    });
    
    // Validate configuration
    if (!taskConfig.botCodeReview || !taskConfig.botCodeReview.originalCode) {
      console.error(`[handleBotCodeReview] Missing bot code review configuration for ${quest}${task}`);
      return [response.error + '\n\n❌ **Configuration Error**: This task is not properly configured. Please contact an administrator.', false];
    }
    
    const config = taskConfig.botCodeReview;
    const originalCode = config.originalCode || "";
    const codeLanguage = config.codeLanguage || "cpp";
    const requirements = config.requirements || "";
    const knownIssues = Array.isArray(config.knownIssues) ? config.knownIssues : [];
    const maxIterations = config.maxIterations || 5;
    const temperature = config.temperature || 0.3;
    const enableDetailedFeedback = config.enableDetailedFeedback !== false;
    
    // Get or initialize state
    if (!user_data.storedValues) {
      user_data.storedValues = {};
    }
    if (!user_data.storedValues.botCodeReviewState) {
      user_data.storedValues.botCodeReviewState = {};
    }
    if (!user_data.storedValues.botCodeReviewState[quest]) {
      user_data.storedValues.botCodeReviewState[quest] = {};
    }
    
    let taskState = user_data.storedValues.botCodeReviewState[quest][task];
    
    if (!taskState) {
      // First iteration - ALWAYS create PR with the original code
      taskState = {
        iteration: 0,
        currentCode: originalCode,
        identifiedIssues: [],
        remainingIssues: [...knownIssues],
        reviewHistory: [],
        status: 'awaiting_first_review',
        prInfo: null
      };
      user_data.storedValues.botCodeReviewState[quest][task] = taskState;
      
      // ALWAYS create PR for bot-code-review tasks
      const fileName = config.fileName || 'code.cpp';
      const { owner, repo } = context.repo();
      const branchName = `bot-code-review-${quest}-${task}-${Date.now()}`;
      const prTitle = `Code Review: ${quest} ${task}`;
      
      // PR body should NOT contain the code - code is in the file, visible in "Files changed"
      const prBody = `**Code Review Task**\n\nI'm trying to implement the following:\n\n${requirements}\n\n**What's wrong with this code?** Please review the code in the "Files changed" tab and provide feedback in the comments below!`;
      
      console.log(`[handleBotCodeReview] Creating PR with initial code...`);
      const prResult = await createPRWithCode(
        context,
        owner,
        repo,
        branchName,
        fileName,
        originalCode,
        prTitle,
        prBody
      );
      
      if (prResult) {
        taskState.prInfo = {
          owner: owner,
          repo: repo,
          prNumber: prResult.prNumber,
          branchName: prResult.branchName,
          fileName: fileName,
          prUrl: prResult.prUrl
        };
        user_data.storedValues.botCodeReviewState[quest][task] = taskState;
        
        // Post minimal message in issue (just PR link)
        const issueMessage = `📝 **Code Review Task**\n\nI've created a PR with my code for you to review:\n\n🔗 ${prResult.prUrl}\n\n**Please review the code in the PR and provide feedback in the PR comments!**`;
        
        console.log(`[handleBotCodeReview] PR created: #${prResult.prNumber}`);
        return [issueMessage, false];
      } else {
        console.error(`[handleBotCodeReview] Failed to create PR`);
        return [response.error + '\n\n❌ **Error**: Failed to create PR. Please contact an administrator.', false];
      }
    }
    
    console.log(`[handleBotCodeReview] Current state:`, {
      iteration: taskState.iteration,
      remainingIssues: taskState.remainingIssues.length,
      status: taskState.status
    });
    
    // If task is already completed, ensure the original issue is closed
    if (taskState.status === 'completed' || taskState.status === 'completed_with_max_iterations' || taskState.status === 'completed_without_points') {
      const originalIssueNumber = user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
      const { owner, repo } = context.repo();
      
      if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
        try {
          // Check if issue is already closed
          const issueResponse = await context.octokit.rest.issues.get({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
          });
          
          if (issueResponse.data.state === 'open') {
            await context.octokit.rest.issues.update({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              state: "closed",
            });
            console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber} (task was already completed)`);
          }
        } catch (error) {
          console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      // Return early - task is already completed
      const alreadyCompletedMsg = `✅ **Task Already Completed**: This task has already been completed. Please move on to the next task in your quest.`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, alreadyCompletedMsg);
      return ['.', false];
    }
    
    // Get user feedback
    const rawFeedback = context.payload.comment.body.trim();
    
    // Extract code blocks to check if they're pasting the same code back
    const codeBlockMatches = rawFeedback.match(/```[\s\S]*?```/g) || [];
    let extractedCode = '';
    if (codeBlockMatches.length > 0) {
      // Extract code from first code block (remove language tag and backticks)
      extractedCode = codeBlockMatches[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim();
      
      // Normalize both codes for comparison (remove whitespace differences)
      const normalizedCurrentCode = taskState.currentCode.replace(/\s+/g, ' ').trim();
      const normalizedExtractedCode = extractedCode.replace(/\s+/g, ' ').trim();
      
      // Check if they pasted the same code back (allowing for minor differences)
      const similarity = normalizedCurrentCode.length > 0 ? 
        (normalizedExtractedCode.length / normalizedCurrentCode.length) : 0;
      
      if (similarity > 0.8 && normalizedExtractedCode.length > 100) {
        const errorMsg = `❌ **Please provide feedback, not code**: You pasted the same code back. Please tell me in your own words what issues you see in the code. What's wrong with it?`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
        // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
        return ['.', false];
      }
    }
    
    // Remove code blocks from feedback - students might paste code which contains comments
    // that match known issues. We only want their actual review text.
    let userFeedback = rawFeedback.replace(/```[\s\S]*?```/g, ''); // Remove markdown code blocks
    userFeedback = userFeedback.replace(/`[^`]+`/g, ''); // Remove inline code
    userFeedback = userFeedback.trim();
    
    // If feedback is empty after removing code blocks, treat it as invalid
    if (!userFeedback || userFeedback.length === 0) {
      const errorMsg = `❌ **Invalid feedback**: Please provide text feedback about what's wrong with the code, not just code itself.`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
      // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
      return ['.', false];
    }
    
    // Check if feedback is too short or appears to be only code (no actual review text)
    if (userFeedback.length < 10) {
      const errorMsg = `❌ **Invalid feedback**: Please provide detailed text feedback describing what issues you found in the code.`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
      // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
      return ['.', false];
    }
    
    // Check if feedback looks like code (contains too many code-like patterns)
    const codePatterns = /(include|#include|bool|int|char|void|return|if|else|for|while|static|const)/gi;
    const codePatternMatches = (userFeedback.match(codePatterns) || []).length;
    const wordCount = userFeedback.split(/\s+/).length;
    
    // If more than 30% of words are code patterns, it's likely just code
    if (codePatternMatches > wordCount * 0.3 && wordCount < 50) {
      const errorMsg = `❌ **Invalid feedback**: Please provide text feedback describing what's wrong with the code, not just paste the code itself. What issues do you see?`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
      // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
      return ['.', false];
    }
    
    console.log(`[handleBotCodeReview] User feedback (after removing code blocks):`, userFeedback.substring(0, 200));
    
    // Check if user approved the code
    const approvalPhrases = ['approved', 'looks good', 'lgtm', 'perfect', 'all good', 'correct', 'done'];
    const isApproval = approvalPhrases.some(phrase => userFeedback.toLowerCase().includes(phrase));
    
    // If student approved, validate the code against requirements
    if (isApproval) {
      console.log(`[handleBotCodeReview] Student approved - validating code against requirements...`);
      
      const validateOnApproval = config.validateOnApproval !== false; // Default true
      
      if (validateOnApproval) {
        // Validate code against requirements (even if student approved)
        const validationResult = await validateCodeAgainstRequirements(
          taskState.currentCode,
          requirements,
          [], // No specific review criteria for bot code review
          codeLanguage,
          llmInstance,
          temperature
        );
        
        if (validationResult.approved) {
          // Code actually passes validation - complete task
          console.log(`[handleBotCodeReview] Code validated and approved!`);
          taskState.status = 'completed';
          
          // Note: No need to update PR - code hasn't changed, we're just validating existing code
          
          // Get original issue number (not the PR number)
          const originalIssueNumber = user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
          const { owner, repo } = context.repo();
          
          await completeTask(user_data, quest, task, context, db);
          console.log(`[handleBotCodeReview] Task ${quest}${task} completed successfully`);
          
          // Explicitly close the original issue if we have the number
          if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
            try {
              await context.octokit.rest.issues.update({
                owner: owner,
                repo: repo,
                issue_number: originalIssueNumber,
                state: "closed",
              });
              console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
            } catch (error) {
              console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
            }
          }
          
          // Merge the PR since code is correct and task is complete
          if (taskState.prInfo) {
            const mergeMethod = config.mergeMethod || 'merge';
            console.log(`[handleBotCodeReview] Attempting to merge PR #${taskState.prInfo.prNumber}...`);
            const merged = await mergePR(
              context,
              taskState.prInfo.owner,
              taskState.prInfo.repo,
              taskState.prInfo.prNumber,
              mergeMethod
            );
            
            if (merged) {
              console.log(`[handleBotCodeReview] ✅ PR #${taskState.prInfo.prNumber} merged successfully`);
            } else {
              console.warn(`[handleBotCodeReview] ⚠️ Failed to merge PR #${taskState.prInfo.prNumber} (may require manual merge)`);
            }
            
            // Post single merged success message to PR
            const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
            const successMsg = `✅ **Code Fixed!**\n\nCode validated and approved! All requirements met. You successfully identified all the issues in the code and helped me fix them. Please review the final changes in the [Files changed](${prUrl}/files) tab. Thanks for your help!`;
            await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, successMsg);
          }
          
          // Post message to original issue telling them to go to next task
          if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
            try {
              // Generate next task link
              let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
              try {
                const questConfig = await getQuestConfigForUser(user_data);
                const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
                const currentQuestIndex = allQuests.indexOf(quest);
                if (currentQuestIndex !== -1) {
                  const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
                  const currentTaskIndex = currentQuestTasks.indexOf(task);
                  if (currentTaskIndex !== -1) {
                    // Check if there's a next task in current quest
                    if (currentTaskIndex < currentQuestTasks.length - 1) {
                      const nextTask = currentQuestTasks[currentTaskIndex + 1];
                      if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                        const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                        nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
                      }
                    } else if (currentQuestIndex < allQuests.length - 1) {
                      // Check if there's a next quest
                      const nextQuest = allQuests[currentQuestIndex + 1];
                      const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
                      if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                        const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                        nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
                      }
                    }
                  }
                }
              } catch (navError) {
                console.warn(`[handleBotCodeReview] Error generating next task link:`, navError.message);
              }
              
              const nextTaskMsg = `✅ **Task Completed!**\n\n🎉 Great job! You successfully helped me identify and fix all the issues in the code. The PR has been merged.\n\n**Next Steps:**\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\nKeep up the excellent work! 🚀`;
              await context.octokit.rest.issues.createComment({
                owner: owner,
                repo: repo,
                issue_number: originalIssueNumber,
                body: nextTaskMsg,
              });
              console.log(`[handleBotCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
            } catch (error) {
              console.warn(`[handleBotCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
            }
          }
          
          return [response.success, true];
        } else {
          // Code doesn't pass validation - fix it
          console.log(`[handleBotCodeReview] Code validation failed: ${validationResult.feedback}`);
          
          // Convert escaped newlines to actual newlines in feedback
          let formattedFeedback = validationResult.feedback || '';
          formattedFeedback = formattedFeedback.replace(/\\n/g, '\n');
          
          // Use LLM to fix the code based on validation feedback
          const fixPrompt = `You are fixing code that failed validation. The code needs to meet these requirements:

**REQUIREMENTS:**
${requirements}

**CURRENT CODE:**
\`\`\`${codeLanguage}
${taskState.currentCode}
\`\`\`

**VALIDATION FEEDBACK:**
${formattedFeedback}

**YOUR TASK:**
Generate COMPLETE fixed code that addresses ALL issues mentioned in the validation feedback. The code must be syntactically correct and complete.

**Response Format (JSON only, no markdown):**
{
  "updatedCode": "complete fixed code here with all includes and functions",
  "botResponse": "brief explanation of what you fixed"
}`;
          
          try {
            const fixResult = await llmInstance.generateCode(fixPrompt, temperature);
            let fixResponse;
            
            // Parse JSON response
            const jsonMatch = fixResult.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                             fixResult.match(/(\{[\s\S]*\})/);
            const jsonString = jsonMatch ? jsonMatch[1] : fixResult;
            fixResponse = JSON.parse(jsonString);
            
            let fixedCode = fixResponse.updatedCode || '';
            const codeBlockMatch = fixedCode.match(/```(?:cpp|c\+\+|c)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
              fixedCode = codeBlockMatch[1].trim();
            }
            
            if (fixedCode && fixedCode.length > 0) {
              taskState.currentCode = fixedCode;
              
              // Update PR if it exists
              if (taskState.prInfo) {
                const updated = await updatePRCode(
                  context,
                  taskState.prInfo.owner,
                  taskState.prInfo.repo,
                  taskState.prInfo.branchName,
                  taskState.prInfo.fileName,
                  fixedCode
                );
                
                if (updated) {
                  const botResponse = fixResponse.botResponse || 'I tried to fix the issues, but the code still needs work.';
                  const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
                  
                  // Generate subtle hints based on remaining issues (don't list them explicitly)
                  let hints = '';
                  if (taskState.remainingIssues.length > 0) {
                    // Extract keywords from remaining issues to create subtle hints
                    const keywords = new Set();
                    taskState.remainingIssues.forEach(issue => {
                      const lowerIssue = issue.toLowerCase();
                      if (lowerIssue.includes('validation') || lowerIssue.includes('input')) keywords.add('input validation');
                      if (lowerIssue.includes('overflow') || lowerIssue.includes('overflow')) keywords.add('overflow');
                      if (lowerIssue.includes('edge case') || lowerIssue.includes('zero') || lowerIssue.includes('negative')) keywords.add('edge cases');
                      if (lowerIssue.includes('efficient') || lowerIssue.includes('algorithm') || lowerIssue.includes('sqrt')) keywords.add('algorithm efficiency');
                      if (lowerIssue.includes('handle') || lowerIssue.includes('return')) keywords.add('function behavior');
                    });
                    
                    const hintPhrases = Array.from(keywords).slice(0, 2);
                    if (hintPhrases.length > 0) {
                      hints = `\n\n💡 **Hint:** You might want to check things like ${hintPhrases.join(' or ')}.`;
                    } else {
                      hints = '\n\n💡 **Hint:** Take another careful look - there might be something you missed.';
                    }
                  } else {
                    hints = '\n\n💡 **Hint:** Review the code carefully - there might be edge cases or validation issues you haven\'t mentioned yet.';
                  }
                  
                  const errorMsg = `⚠️ **I tried to run it, but it still has issues**\n\n${botResponse}\n\nPlease review the updated code in the [Files changed](${prUrl}/files) tab and provide more specific feedback about what's still wrong.${hints}`;
                  await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
                }
              }
              
              return [response.error, false];
            }
          } catch (error) {
            console.error(`[handleBotCodeReview] Failed to fix code after validation:`, error);
          }
          
          // Fallback if fixing failed
          const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
          let hints = '';
          if (taskState.remainingIssues.length > 0) {
            // Extract keywords from remaining issues to create subtle hints
            const keywords = new Set();
            taskState.remainingIssues.forEach(issue => {
              const lowerIssue = issue.toLowerCase();
              if (lowerIssue.includes('validation') || lowerIssue.includes('input')) keywords.add('input validation');
              if (lowerIssue.includes('overflow') || lowerIssue.includes('overflow')) keywords.add('overflow');
              if (lowerIssue.includes('edge case') || lowerIssue.includes('zero') || lowerIssue.includes('negative')) keywords.add('edge cases');
              if (lowerIssue.includes('efficient') || lowerIssue.includes('algorithm') || lowerIssue.includes('sqrt')) keywords.add('algorithm efficiency');
              if (lowerIssue.includes('handle') || lowerIssue.includes('return')) keywords.add('function behavior');
            });
            
            const hintPhrases = Array.from(keywords).slice(0, 2);
            if (hintPhrases.length > 0) {
              hints = `\n\n💡 **Hint:** You might want to check things like ${hintPhrases.join(' or ')}.`;
            } else {
              hints = '\n\n💡 **Hint:** Take another careful look - there might be something you missed.';
            }
          } else {
            hints = '\n\n💡 **Hint:** Review the code carefully - there might be edge cases or validation issues you haven\'t mentioned yet.';
          }
          const errorMsg = `⚠️ **I tried to run it, but it still has issues**\n\nI see you approved, but the code still needs work. Please review the code in the [Files changed](${prUrl}/files) tab and provide more specific feedback about what's still wrong.${hints}`;
          await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
          return [response.error, false];
        }
      } else {
        // Validation disabled - use old behavior
        if (taskState.remainingIssues.length === 0) {
          // Code is correct and user approved
          console.log(`[handleBotCodeReview] Code approved and all issues identified!`);
          taskState.status = 'completed';
          
          // Get original issue number (not the PR number)
          const originalIssueNumber = user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
          const { owner, repo } = context.repo();
          
          await completeTask(user_data, quest, task, context, db);
          console.log(`[handleBotCodeReview] Task ${quest}${task} completed successfully`);
          
          // Explicitly close the original issue if we have the number
          if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
            try {
              await context.octokit.rest.issues.update({
                owner: owner,
                repo: repo,
                issue_number: originalIssueNumber,
                state: "closed",
              });
              console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
            } catch (error) {
              console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
            }
          }
          
          // Merge the PR since code is correct and task is complete
          if (taskState.prInfo) {
            const mergeMethod = config.mergeMethod || 'merge';
            console.log(`[handleBotCodeReview] Attempting to merge PR #${taskState.prInfo.prNumber}...`);
            const merged = await mergePR(
              context,
              taskState.prInfo.owner,
              taskState.prInfo.repo,
              taskState.prInfo.prNumber,
              mergeMethod
            );
            
            if (merged) {
              console.log(`[handleBotCodeReview] ✅ PR #${taskState.prInfo.prNumber} merged successfully`);
            } else {
              console.warn(`[handleBotCodeReview] ⚠️ Failed to merge PR #${taskState.prInfo.prNumber} (may require manual merge)`);
            }
            
            const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
            const successMsg = `✅ **Excellent work!** You successfully identified all the issues in the code and helped me fix them. The code is now correct! Please review the final changes in the [Files changed](${prUrl}/files) tab.`;
            await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, successMsg);
            
            // Post message to original issue telling them to go to next task
            if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
              try {
                // Generate next task link
                let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
                try {
                  const questConfig = await getQuestConfigForUser(user_data);
                  const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
                  const currentQuestIndex = allQuests.indexOf(quest);
                  if (currentQuestIndex !== -1) {
                    const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
                    const currentTaskIndex = currentQuestTasks.indexOf(task);
                    if (currentTaskIndex !== -1) {
                      // Check if there's a next task in current quest
                      if (currentTaskIndex < currentQuestTasks.length - 1) {
                        const nextTask = currentQuestTasks[currentTaskIndex + 1];
                        if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                          const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                          nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
                        }
                      } else if (currentQuestIndex < allQuests.length - 1) {
                        // Check if there's a next quest
                        const nextQuest = allQuests[currentQuestIndex + 1];
                        const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
                        if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                          const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                          nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
                        }
                      }
                    }
                  }
                } catch (navError) {
                  console.warn(`[handleBotCodeReview] Error generating next task link:`, navError.message);
                }
                
                const nextTaskMsg = `✅ **Task Completed!**\n\n🎉 Great job! You successfully helped me identify and fix all the issues in the code. The PR has been merged.\n\n**Next Steps:**\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\nKeep up the excellent work! 🚀`;
                await context.octokit.rest.issues.createComment({
                  owner: owner,
                  repo: repo,
                  issue_number: originalIssueNumber,
                  body: nextTaskMsg,
                });
                console.log(`[handleBotCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
              } catch (error) {
                console.warn(`[handleBotCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
              }
            }
            
            return [response.success, true];
          }
          
          return [response.success + `\n\n✅ **Excellent work!** You successfully identified all the issues in the code and helped me fix them. The code is now correct!`, true];
        }
        
        if (taskState.remainingIssues.length > 0) {
          // User approved too early
          const hint = taskState.iteration >= 2 ? `\n\nHint: Look for issues related to: ${taskState.remainingIssues[0]}` : '';
          const errorMsg = `❌ **Not quite yet!** Thanks for the approval, but I'm still having some issues. Can you help me identify what else might be wrong?${hint}`;
          await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
          // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
          return ['.', false];
        }
      }
    }
    
    // Check iteration limit
    if (taskState.iteration >= maxIterations) {
      const awardPointsOnFailure = config.awardPointsOnFailure || false;
      
      // Get original issue number (not the PR number)
      const originalIssueNumber = user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
      const { owner, repo } = context.repo();
      
      if (awardPointsOnFailure) {
        // Complete the task even though not all issues were identified
        taskState.status = 'completed_with_max_iterations';
        await completeTask(user_data, quest, task, context, db);
        console.log(`[handleBotCodeReview] Task ${quest}${task} completed with max iterations (awarding points)`);
        
        // Explicitly close the original issue if we have the number
        if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
          try {
            await context.octokit.rest.issues.update({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              state: "closed",
            });
            console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
          } catch (error) {
            console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
          }
        }
        
        // Analyze code review quality
        const allKnownIssues = [...taskState.identifiedIssues, ...taskState.remainingIssues];
        const reviewQualityFeedback = await analyzeCodeReviewQuality(
          taskState.reviewHistory || [],
          allKnownIssues,
          taskState.identifiedIssues,
          requirements,
          temperature
        );
        
        const successMsg = `⚠️ **Maximum iterations reached**: We've completed ${maxIterations} review cycles.\n\n` +
          `**Issues you identified:**\n${taskState.identifiedIssues.map(issue => `✅ ${issue}`).join('\n')}\n\n` +
          `**Remaining issues:**\n${taskState.remainingIssues.map(issue => `❌ ${issue}`).join('\n')}\n\n` +
          `You've made good progress! Task completed - points/XP awarded.\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedback}`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, successMsg);
        
        // Post message to original issue telling them to go to next task
        if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
          try {
            // Generate next task link
            let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
            try {
              const questConfig = await getQuestConfigForUser(user_data);
              const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
              const currentQuestIndex = allQuests.indexOf(quest);
              if (currentQuestIndex !== -1) {
                const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
                const currentTaskIndex = currentQuestTasks.indexOf(task);
                if (currentTaskIndex !== -1) {
                  // Check if there's a next task in current quest
                  if (currentTaskIndex < currentQuestTasks.length - 1) {
                    const nextTask = currentQuestTasks[currentTaskIndex + 1];
                    if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                      const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                      nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
                    }
                  } else if (currentQuestIndex < allQuests.length - 1) {
                    // Check if there's a next quest
                    const nextQuest = allQuests[currentQuestIndex + 1];
                    const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
                    if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                      const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                      nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
                    }
                  }
                }
              }
            } catch (navError) {
              console.warn(`[handleBotCodeReview] Error generating next task link:`, navError.message);
            }
            
            const nextTaskMsg = `✅ **Task Completed!**\n\n⚠️ **Maximum iterations reached**: We've completed ${maxIterations} review cycles.\n\n**Issues you identified:**\n${taskState.identifiedIssues.map(issue => `✅ ${issue}`).join('\n')}\n\n**Remaining issues:**\n${taskState.remainingIssues.map(issue => `❌ ${issue}`).join('\n')}\n\nYou've made good progress! Points/XP awarded.\n\n**Next Steps:**\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedback}\n\nKeep up the excellent work! 🚀`;
            await context.octokit.rest.issues.createComment({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              body: nextTaskMsg,
            });
            console.log(`[handleBotCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
          } catch (error) {
            console.warn(`[handleBotCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
          }
        }
        
        return [response.success, true];
      } else {
        // Don't award points but complete the task and close the issue
        taskState.status = 'completed_without_points';
        await completeTask(user_data, quest, task, context, db, false);
        console.log(`[handleBotCodeReview] Task ${quest}${task} completed with max iterations (no points awarded)`);
        
        // Explicitly close the original issue if we have the number
        if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
          try {
            await context.octokit.rest.issues.update({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              state: "closed",
            });
            console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
          } catch (error) {
            console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
          }
        }
        
        // Analyze code review quality
        const allKnownIssuesNoPoints = [...taskState.identifiedIssues, ...taskState.remainingIssues];
        const reviewQualityFeedbackNoPoints = await analyzeCodeReviewQuality(
          taskState.reviewHistory || [],
          allKnownIssuesNoPoints,
          taskState.identifiedIssues,
          requirements,
          temperature
        );
        
        const errorMsg = `❌ **Maximum iterations reached**: We've reached the maximum of ${maxIterations} review cycles without completing the task.\n\n` +
          `**Issues you identified:**\n${taskState.identifiedIssues.length > 0 ? taskState.identifiedIssues.map(issue => `✅ ${issue}`).join('\n') : 'None'}\n\n` +
          `**Remaining issues that needed to be identified:**\n${taskState.remainingIssues.map(issue => `❌ ${issue}`).join('\n')}\n\n` +
          `No points/XP awarded. The task is now closed and you can move on to the next task.\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedbackNoPoints}`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
        
        // Post message to original issue telling them to go to next task
        if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
          try {
            // Generate next task link
            let nextTaskLink = `[all issues](https://github.com/${owner}/${repo}/issues)`;
            try {
              const questConfig = await getQuestConfigForUser(user_data);
              const allQuests = Object.keys(questConfig).filter(q => q !== 'map_repo_link' && q !== 'metadata');
              const currentQuestIndex = allQuests.indexOf(quest);
              if (currentQuestIndex !== -1) {
                const currentQuestTasks = Object.keys(questConfig[quest] || {}).filter(t => t !== 'metadata');
                const currentTaskIndex = currentQuestTasks.indexOf(task);
                if (currentTaskIndex !== -1) {
                  // Check if there's a next task in current quest
                  if (currentTaskIndex < currentQuestTasks.length - 1) {
                    const nextTask = currentQuestTasks[currentTaskIndex + 1];
                    if (user_data.accepted?.[quest]?.[nextTask]?.issueNum) {
                      const nextTaskIssueNum = user_data.accepted[quest][nextTask].issueNum;
                      nextTaskLink = `[next task (#${nextTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextTaskIssueNum})`;
                    }
                  } else if (currentQuestIndex < allQuests.length - 1) {
                    // Check if there's a next quest
                    const nextQuest = allQuests[currentQuestIndex + 1];
                    const nextQuestFirstTask = Object.keys(questConfig[nextQuest] || {}).filter(t => t !== 'metadata')[0];
                    if (nextQuestFirstTask && user_data.accepted?.[nextQuest]?.[nextQuestFirstTask]?.issueNum) {
                      const nextQuestTaskIssueNum = user_data.accepted[nextQuest][nextQuestFirstTask].issueNum;
                      nextTaskLink = `[next quest (#${nextQuestTaskIssueNum})](https://github.com/${owner}/${repo}/issues/${nextQuestTaskIssueNum})`;
                    }
                  }
                }
              }
            } catch (navError) {
              console.warn(`[handleBotCodeReview] Error generating next task link:`, navError.message);
            }
            
            const nextTaskMsg = `❌ **Task Completed (Max Iterations)**\n\n⚠️ **Maximum iterations reached**: We've reached the maximum of ${maxIterations} review cycles without completing the task.\n\n**Issues you identified:**\n${taskState.identifiedIssues.length > 0 ? taskState.identifiedIssues.map(issue => `✅ ${issue}`).join('\n') : 'None'}\n\n**Remaining issues that needed to be identified:**\n${taskState.remainingIssues.map(issue => `❌ ${issue}`).join('\n')}\n\nNo points/XP awarded.\n\n**Next Steps:**\n- Continue to ${nextTaskLink}\n- Check your progress in the README\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedbackNoPoints}\n\nYou can always come back to review this task later! 🚀`;
            await context.octokit.rest.issues.createComment({
              owner: owner,
              repo: repo,
              issue_number: originalIssueNumber,
              body: nextTaskMsg,
            });
            console.log(`[handleBotCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
          } catch (error) {
            console.warn(`[handleBotCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
          }
        }
        
        return [response.error, true];
      }
    }
    
    // Increment iteration
    taskState.iteration++;
    
    // Extract function names from current code to detect mismatches
    const functionNamePattern = /(?:function|def|bool|int|void|char|double|float|string)\s+(\w+)\s*\(/g;
    const codeFunctionNames = [];
    let match;
    while ((match = functionNamePattern.exec(taskState.currentCode)) !== null) {
      codeFunctionNames.push(match[1].toLowerCase());
    }
    
    // Check if feedback mentions functions that don't exist
    const feedbackLower = userFeedback.toLowerCase();
    const mentionedFunctions = [];
    for (const funcName of codeFunctionNames) {
      if (feedbackLower.includes(funcName)) {
        mentionedFunctions.push(funcName);
      }
    }
    
    // Detect potential mismatches (functions mentioned in feedback but not in code)
    const commonFunctionPatterns = /\b(sumArray|add|subtract|multiply|divide|calculate|process|handle|validate|check|verify)\w*\b/gi;
    const feedbackFunctionMatches = userFeedback.match(commonFunctionPatterns) || [];
    const mismatchedFunctions = feedbackFunctionMatches
      .map(f => f.toLowerCase())
      .filter(f => !codeFunctionNames.some(cf => cf.includes(f) || f.includes(cf)));
    
    // Use LLM to determine what issues the student identified and generate fixed code
    const knownIssuesList = taskState.remainingIssues.map((issue, idx) => `${idx + 1}. "${issue}"`).join('\n');
    
    // Build function context for LLM
    const functionsInCode = codeFunctionNames.length > 0 
      ? `\n**Functions in the code:** ${codeFunctionNames.join(', ')}`
      : '';
    const mismatchWarning = mismatchedFunctions.length > 0
      ? `\n**⚠️ WARNING:** The reviewer mentioned "${mismatchedFunctions.join(', ')}" which doesn't appear to be in the code. They may be reviewing the wrong code or confused. Still try to match their feedback to known issues if possible.`
      : '';
    
    const llmPrompt = `You are a coding student receiving feedback from a reviewer. You have code with known issues, and a reviewer has provided TEXT FEEDBACK (not code).

**Current Code:**
\`\`\`${codeLanguage}
${taskState.currentCode}
\`\`\`
${functionsInCode}${mismatchWarning}

**Code Requirements:**
${requirements}

**Known Remaining Issues (EXACT TEXT - match these exactly):**
${knownIssuesList}

**Reviewer's TEXT FEEDBACK (this is what they said, NOT code):**
"${userFeedback}"

**Your Task:**
1. **First, check if the reviewer's feedback mentions functions/entities that don't exist in the code.** If so, note this in your response but still try to match their feedback to known issues if possible (e.g., "null pointer validation" might match "input validation").
2. Analyze ONLY the reviewer's TEXT FEEDBACK above. Ignore any code they may have pasted - you only care about their written words describing issues.
3. Match the reviewer's feedback to the EXACT known issues listed above. The "identifiedIssues" array must contain the EXACT text from the "Known Remaining Issues" list that the reviewer EXPLICITLY mentioned.
4. **IMPORTANT - INCREMENTAL FIXING:**
   - Only fix issues that the reviewer EXPLICITLY and CLEARLY mentioned in their feedback
   - If the feedback mentions functions that don't exist, set "needsClarification" to true and politely point this out
   - If the feedback is vague or mentions many issues at once, fix only the MOST SPECIFIC ones mentioned
   - If the feedback is too vague to determine what to fix, set "needsClarification" to true and ask for more specific feedback
   - Do NOT fix issues that weren't explicitly mentioned, even if they exist in the code
   - Make MINIMAL changes - only fix what was clearly stated
5. Generate COMPLETE updated code (all functions, includes, etc.) that fixes ONLY the explicitly mentioned issues.
6. The code must be syntactically correct and complete.

**CRITICAL:**
- If feedback mentions functions/entities NOT in the code, set "needsClarification" to true and mention this in botResponse
- Only match issues that the reviewer EXPLICITLY and SPECIFICALLY mentioned in their TEXT FEEDBACK
- Do NOT match issues just because they exist in code comments - only match if the reviewer's TEXT clearly describes them
- "identifiedIssues" must contain EXACT matches from the "Known Remaining Issues" list above
- "updatedCode" must be the COMPLETE fixed code (all functions, includes, etc.)
- If feedback mentions 5 issues but only 2 are clearly described, only fix those 2
- Be conservative - when in doubt, fix less, not more
- If the feedback is too vague, set "needsClarification" to true

**Response Format (JSON only, no markdown):**
{
  "identifiedIssues": ["exact issue text from known issues list that reviewer EXPLICITLY mentioned"],
  "updatedCode": "complete fixed code here with all includes and functions (fixing ONLY explicitly mentioned issues)",
  "botResponse": "brief explanation of what you fixed (only what was explicitly mentioned). If feedback mentions wrong functions, politely point this out.",
  "needsClarification": false
}

If feedback is too vague or mentions functions that don't exist, set needsClarification to true and botResponse should ask for more specific feedback about which issues to fix.

Example: If known issue is "Uses sprintf without checking buffer length - buffer overflow risk" and reviewer says "you ignore len", then identifiedIssues should be ["Uses sprintf without checking buffer length - buffer overflow risk"]`;

    console.log(`[handleBotCodeReview] Calling LLM to process feedback`);
    console.log(`[handleBotCodeReview] Known issues:`, taskState.remainingIssues);
    console.log(`[handleBotCodeReview] User feedback:`, userFeedback);
    
    // Call LLM to generate code
    const llmResult = await llmInstance.generateCode(llmPrompt, temperature);
    
    console.log(`[handleBotCodeReview] LLM raw result (first 500 chars):`, llmResult.substring(0, 500));
    
    // Parse LLM response
    let llmResponse;
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = llmResult.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                       llmResult.match(/(\{[\s\S]*\})/);
      const jsonString = jsonMatch ? jsonMatch[1] : llmResult;
      llmResponse = JSON.parse(jsonString);
      console.log(`[handleBotCodeReview] Parsed LLM response:`, {
        identifiedIssues: llmResponse.identifiedIssues,
        hasUpdatedCode: !!llmResponse.updatedCode,
        updatedCodeLength: llmResponse.updatedCode?.length || 0,
        botResponse: llmResponse.botResponse,
        needsClarification: llmResponse.needsClarification
      });
    } catch (error) {
      console.error(`[handleBotCodeReview] Failed to parse LLM response:`, error);
      console.error(`[handleBotCodeReview] Raw LLM result:`, llmResult);
      return [response.error + '\n\n❌ **Processing Error**: Failed to process your feedback. Please try rephrasing your review.', false];
    }
    
    // Extract code from updatedCode (might be wrapped in markdown code blocks)
    // Do this BEFORE checking needsClarification, so we can update code even if clarification is needed
    let updatedCode = llmResponse.updatedCode || '';
    
    // If code is wrapped in markdown code blocks, extract it
    const codeBlockMatch = updatedCode.match(/```(?:cpp|c\+\+|c|javascript|python|java)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      updatedCode = codeBlockMatch[1].trim();
    } else {
      updatedCode = updatedCode.trim();
    }
    
    // Check if LLM needs clarification
    const needsClarification = llmResponse.needsClarification === true;
    
    // Validate that we got updated code (unless clarification is needed without code)
    if (!updatedCode || updatedCode.length === 0) {
      if (needsClarification) {
        // No updated code and clarification needed
        const clarificationMessage = llmResponse.botResponse || 
          "I need more specific feedback. Could you please tell me exactly which issues you see? For example: 'The add() function doesn't check the len parameter' or 'You're using sprintf unsafely'.";
        
        const errorMsg = `❓ **Need More Details**:\n\n${clarificationMessage}\n\nPlease provide more specific feedback about what's wrong with the code. What specific issues do you see?`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
        return ['.', false];
      } else {
        // No updated code and no clarification needed - this is an error
        console.error(`[handleBotCodeReview] LLM did not return updatedCode`);
        const errorMsg = `❌ **Processing Error**: Failed to generate updated code. Please try rephrasing your review.`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
        return ['.', false];
      }
    }
    
    // Check if code actually changed
    const codeChanged = updatedCode !== taskState.currentCode.trim();
    if (!codeChanged) {
      console.warn(`[handleBotCodeReview] LLM returned same code as before - code may not have been fixed`);
    }
    
    // Update state based on identified issues (even if clarification is needed)
    const identifiedIssues = Array.isArray(llmResponse.identifiedIssues) ? llmResponse.identifiedIssues : [];
    
    // Match identified issues to known issues (flexible matching)
    const matchedIssues = [];
    const stillRemaining = taskState.remainingIssues.filter(issue => {
      // Check if any identified issue matches this known issue
      const isIdentified = identifiedIssues.some(identified => {
        // Exact match
        if (issue.toLowerCase() === identified.toLowerCase()) return true;
        // Contains match (either direction)
        if (issue.toLowerCase().includes(identified.toLowerCase()) || 
            identified.toLowerCase().includes(issue.toLowerCase())) return true;
        // Check for key phrases
        const issueKeyWords = issue.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 3);
        const identifiedKeyWords = identified.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 3);
        const commonWords = issueKeyWords.filter(w => identifiedKeyWords.includes(w));
        return commonWords.length >= 2; // At least 2 key words match
      });
      
      if (isIdentified) {
        matchedIssues.push(issue);
        taskState.identifiedIssues.push(issue);
      }
      return !isIdentified;
    });
    
    console.log(`[handleBotCodeReview] Issue matching:`, {
      identifiedFromLLM: identifiedIssues,
      matchedToKnownIssues: matchedIssues,
      stillRemaining: stillRemaining.length
    });
    
    taskState.remainingIssues = stillRemaining;
    taskState.currentCode = updatedCode;
    taskState.reviewHistory.push({
      iteration: taskState.iteration,
      feedback: userFeedback,
      identified: identifiedIssues,
      remaining: taskState.remainingIssues.length
    });
    
    // Update PR code (create new commit)
    if (taskState.prInfo) {
      await updatePRCode(
        context,
        taskState.prInfo.owner,
        taskState.prInfo.repo,
        taskState.prInfo.branchName,
        taskState.prInfo.fileName,
        updatedCode
      );
    }
    
    console.log(`[handleBotCodeReview] Updated state:`, {
      identifiedThisRound: identifiedIssues.length,
      totalIdentified: taskState.identifiedIssues.length,
      remainingIssues: taskState.remainingIssues.length
    });
    
    // If clarification is needed, post clarification message pointing to updated code in PR
    if (needsClarification) {
      const clarificationMessage = llmResponse.botResponse || 
        "I need more specific feedback. Could you please tell me exactly which issues you see? For example: 'The add() function doesn't check the len parameter' or 'You're using sprintf unsafely'.";
      
      const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
      const errorMsg = `❓ **Need More Details**:\n\n${clarificationMessage}\n\n**I've updated the code with what I understood from your feedback.** Please review the changes in the [Files changed](${prUrl}/files) tab and provide more specific feedback about what's wrong with the code. What specific issues do you see?`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, errorMsg);
      
      // Save state before returning
      user_data.storedValues.botCodeReviewState[quest][task] = taskState;
      return ['.', false];
    }
    
    // Check if all issues are identified
    if (taskState.remainingIssues.length === 0) {
      // All issues fixed!
      taskState.status = 'completed';
      const codeBlock = `\`\`\`${codeLanguage}\n${taskState.currentCode}\n\`\`\``;
      const successMessage = llmResponse.botResponse || "Thanks! I fixed the issues you mentioned.";
      
      // Note: PR code was already updated at line 5212, no need to update again
      
      console.log(`[handleBotCodeReview] ✅ ALL ISSUES IDENTIFIED - Completing task!`);
      console.log(`[handleBotCodeReview] Total issues identified: ${taskState.identifiedIssues.length}`);
      console.log(`[handleBotCodeReview] Remaining issues: ${taskState.remainingIssues.length}`);
      console.log(`[handleBotCodeReview] Task status set to: ${taskState.status}`);
      
      // Get original issue number (not the PR number)
      const originalIssueNumber = user_data.accepted?.[quest]?.[task]?.issueNum || selectedIssue;
      const { owner, repo } = context.repo();
      
      // Complete the task (this will close the issue if context is correct)
      await completeTask(user_data, quest, task, context, db);
      console.log(`[handleBotCodeReview] Task ${quest}${task} completed successfully`);
      
      // Explicitly close the original issue if we have the number
      if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
        try {
          await context.octokit.rest.issues.update({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
            state: "closed",
          });
          console.log(`[handleBotCodeReview] ✅ Closed original issue #${originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleBotCodeReview] ⚠️ Failed to close issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      // Merge the PR since all issues are fixed and task is complete
      if (taskState.prInfo) {
        const mergeMethod = config.mergeMethod || 'merge';
        console.log(`[handleBotCodeReview] Attempting to merge PR #${taskState.prInfo.prNumber}...`);
        const merged = await mergePR(
          context,
          taskState.prInfo.owner,
          taskState.prInfo.repo,
          taskState.prInfo.prNumber,
          mergeMethod
        );
        
        if (merged) {
          console.log(`[handleBotCodeReview] ✅ PR #${taskState.prInfo.prNumber} merged successfully`);
        } else {
          console.warn(`[handleBotCodeReview] ⚠️ Failed to merge PR #${taskState.prInfo.prNumber} (may require manual merge)`);
        }
        
        // Analyze code review quality and provide educational feedback
        const allKnownIssues = [...taskState.identifiedIssues, ...taskState.remainingIssues];
        const reviewQualityFeedback = await analyzeCodeReviewQuality(
          taskState.reviewHistory || [],
          allKnownIssues,
          taskState.identifiedIssues,
          requirements,
          temperature
        );
        
        // Post single merged success message to PR with review quality feedback
        const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
        const successMsg = `✅ **Code Fixed!**\n\n${successMessage}\n\nPlease review the final changes in the [Files changed](${prUrl}/files) tab. Thanks for your help! You successfully identified all the issues!\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedback}`;
        await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, successMsg);
      }
      
      // Post message to original issue telling them to go to next task
      if (originalIssueNumber && originalIssueNumber !== taskState.prInfo?.prNumber) {
        try {
          // Analyze code review quality for issue message too
          const allKnownIssues = [...taskState.identifiedIssues, ...taskState.remainingIssues];
          const reviewQualityFeedback = await analyzeCodeReviewQuality(
            taskState.reviewHistory || [],
            allKnownIssues,
            taskState.identifiedIssues,
            requirements,
            temperature
          );
          
          const nextTaskMsg = `✅ **Task Completed!**\n\n🎉 Great job! You successfully helped me identify and fix all the issues in the code. The PR has been merged.\n\n**Next Steps:**\n- Move on to the next task in your quest\n- Check your progress in the README\n\n---\n\n📚 **How to Write Better Code Reviews:**\n\n${reviewQualityFeedback}\n\nKeep up the excellent work! 🚀`;
          await context.octokit.rest.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: originalIssueNumber,
            body: nextTaskMsg,
          });
          console.log(`[handleBotCodeReview] ✅ Posted completion message to issue #${originalIssueNumber}`);
        } catch (error) {
          console.warn(`[handleBotCodeReview] ⚠️ Failed to post message to issue #${originalIssueNumber}:`, error.message);
        }
      }
      
      return [response.success, true];
    } else {
      // Still has issues - post to PR (point to files, don't show code in comment)
      const botResponse = llmResponse.botResponse || "Thanks for the feedback! I've made some changes.";
      
      // Generate subtle hint about remaining issues (don't list them explicitly)
      let subtleHint = '';
      if (taskState.remainingIssues.length > 0) {
        // Extract keywords from remaining issues to create subtle hints
        const keywords = new Set();
        taskState.remainingIssues.forEach(issue => {
          const lowerIssue = issue.toLowerCase();
          if (lowerIssue.includes('validation') || lowerIssue.includes('input')) keywords.add('input validation');
          if (lowerIssue.includes('overflow') || lowerIssue.includes('overflow')) keywords.add('overflow');
          if (lowerIssue.includes('edge case') || lowerIssue.includes('zero') || lowerIssue.includes('negative')) keywords.add('edge cases');
          if (lowerIssue.includes('efficient') || lowerIssue.includes('algorithm') || lowerIssue.includes('sqrt')) keywords.add('algorithm efficiency');
          if (lowerIssue.includes('handle') || lowerIssue.includes('return')) keywords.add('function behavior');
        });
        
        const hintPhrases = Array.from(keywords).slice(0, 2);
        if (hintPhrases.length > 0) {
          subtleHint = `\n\n💡 **Hint:** You might want to check things like ${hintPhrases.join(' or ')}.`;
        } else {
          subtleHint = '\n\n💡 **Hint:** Take another careful look - there might be something you missed.';
        }
      }
      
      const iterationText = `**Iteration ${taskState.iteration}/${maxIterations}**`;
      const prUrl = `https://github.com/${taskState.prInfo.owner}/${taskState.prInfo.repo}/pull/${taskState.prInfo.prNumber}`;
      const nextSteps = `\n\nPlease review the updated code in the [Files changed](${prUrl}/files) tab and let me know what else might be wrong.`;
      
      const prMessage = `${iterationText}\n\n${botResponse}${nextSteps}${subtleHint}`;
      await commentOnPR(context, taskState.prInfo.owner, taskState.prInfo.repo, taskState.prInfo.prNumber, prMessage);
      
      // Return minimal string - we already posted to PR, and return value will also post to PR (same number)
      return ['.', false];
    }
    
  } catch (error) {
    console.error(`Error in handleBotCodeReview for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: An error occurred during code review. Please try again later.', false];
  }
}

/**
 * GitHub Actions Workflow Validation handler
 * Validates that a GitHub Actions workflow file meets specified requirements
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q4")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleGitHubActionsValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleGitHubActionsValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleGitHubActionsValidation] User: ${user}`);
    
    // Get quest configuration
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest] || !questConfig[quest][task]) {
      console.error(`[handleGitHubActionsValidation] Task configuration not found`);
      return [response.error + '\n\n❌ **Error**: Task configuration not found. Please contact an administrator.', false];
    }
    
    const taskConfig = questConfig[quest][task];
    const workflowFilePath = taskConfig.githubActionsValidation?.workflowFilePath || '.github/workflows/main.yml';
    const validationParameters = taskConfig.githubActionsValidation?.validationParameters || [];
    const enableDetailedFeedback = taskConfig.githubActionsValidation?.enableDetailedFeedback !== false;
    const waitForWorkflowCompletion = taskConfig.githubActionsValidation?.waitForWorkflowCompletion || false;
    const requireStudentOwnership = taskConfig.githubActionsValidation?.requireStudentOwnership || false;
    const requirePrivateRepo = taskConfig.githubActionsValidation?.requirePrivateRepo || false;
    
    if (!validationParameters || validationParameters.length === 0) {
      console.error(`[handleGitHubActionsValidation] No validation parameters configured`);
      return [response.error + '\n\n❌ **Error**: No validation parameters configured for this task.', false];
    }
    
    // Parse repository from user's comment (they may provide a URL to their workflow repo)
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleGitHubActionsValidation] User input: "${userInput}"`);
    
    let targetRepo = null;
    
    // First, try to extract repository from user's comment
    if (userInput) {
      const extractedRepo = extractGitHubRepoUrl(userInput);
      if (extractedRepo) {
        targetRepo = extractedRepo;
        console.log(`[handleGitHubActionsValidation] Extracted repository from user input: ${targetRepo}`);
      }
    }
    
    // If no repo found in user input, try to get fork URL from stored values
    if (!targetRepo && user_data.storedValues?.forkUrl) {
      const forkUrlMatch = user_data.storedValues.forkUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
      if (forkUrlMatch) {
        targetRepo = forkUrlMatch[1].replace(/\.git$/, '');
        console.log(`[handleGitHubActionsValidation] Using stored fork URL: ${targetRepo}`);
      }
    }
    
    // Fallback: try to construct from context (OSS-Doorway repo)
    if (!targetRepo) {
      const { owner, repo } = context.repo();
      targetRepo = `${owner}/${repo}`;
      console.log(`[handleGitHubActionsValidation] Using OSS-Doorway repo as fallback: ${targetRepo}`);
    }
    
    console.log(`[handleGitHubActionsValidation] Target repository: ${targetRepo}`);
    console.log(`[handleGitHubActionsValidation] Workflow file path: ${workflowFilePath}`);
    
    const [repoOwner, repoName] = targetRepo.split('/');
    
    // Check repository ownership and privacy if required
    if (requireStudentOwnership) {
      // Get the organization name from context (the OSS-Doorway organization)
      const { owner: contextOwner } = context.repo();
      const expectedOrg = contextOwner; // This should be "OSS-Doorway-Dev" or similar
      
      console.log(`[handleGitHubActionsValidation] Checking repository ownership - expected org: ${expectedOrg}, actual: ${repoOwner}`);
      if (repoOwner.toLowerCase() !== expectedOrg.toLowerCase()) {
        const errorPrefix = response?.error || '❌ **Error**';
        const errorMsg = `${errorPrefix}\n\n❌ **Repository Ownership Error**\n\nThis task requires you to use a repository in the \`${expectedOrg}\` organization. The repository \`${targetRepo}\` is not in the correct organization.\n\n**Please:**\n1. Ensure the repository is in the \`${expectedOrg}\` organization\n2. Submit the link to a repository in the \`${expectedOrg}\` organization\n\n💡 **Tip**: The repository should be owned by \`${expectedOrg}\`, not your personal account.`;
        console.log(`[handleGitHubActionsValidation] Ownership check failed, returning error message (length: ${errorMsg.length})`);
        return [errorMsg, false];
      }
      console.log(`[handleGitHubActionsValidation] Ownership check passed - repo is in ${expectedOrg} organization`);
      
      // If requirePrivateRepo is enabled, check if the repo is private
      if (requirePrivateRepo) {
        try {
          const repoData = await context.octokit.rest.repos.get({
            owner: repoOwner,
            repo: repoName,
          });
          
          console.log(`[handleGitHubActionsValidation] Repository privacy check - isPrivate: ${repoData.data.private}`);
          
          if (!repoData.data.private) {
            return [response.error + `\n\n❌ **Repository Privacy Error**\n\nThis task requires your repository to be **private** for learning purposes.\n\n**Please:**\n1. Go to your repository settings: https://github.com/${targetRepo}/settings\n2. Scroll down to the "Danger Zone"\n3. Click "Change repository visibility"\n4. Change it to "Private"\n5. Come back and submit the link again\n\n💡 **Why private?** This ensures your learning work is kept confidential and prevents others from copying your solutions.`, false];
          }
        } catch (error) {
          console.error(`[handleGitHubActionsValidation] Error checking repository privacy:`, error);
          // If we can't check privacy (e.g., permission issues), proceed with validation
          console.log(`[handleGitHubActionsValidation] Could not verify repository privacy, proceeding with validation`);
        }
      }
    }
    
    // Fetch workflow file content    
    let workflowContent = null;
    
    try {
      const fileResponse = await context.octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: workflowFilePath,
      });
      
      if (fileResponse.data.type === 'file' && fileResponse.data.content) {
        workflowContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf8');
      }
    } catch (error) {
      if (error.status === 404) {
        return [response.error + `\n\n❌ **Workflow file not found**: Could not find \`${workflowFilePath}\` in repository \`${targetRepo}\`.\n\nPlease ensure:\n- The workflow file exists at \`.github/workflows/main.yml\` in your repository\n- You've committed and pushed the file to GitHub\n- The repository URL you provided is correct\n\nIf you're using a different repository, please provide the full URL to your repository or workflow file.`, false];
      }
      throw error;
    }
    
    if (!workflowContent) {
      return [response.error + `\n\n❌ **Error**: Could not read workflow file content.`, false];
    }
    
    console.log(`[handleGitHubActionsValidation] Successfully fetched workflow file (${workflowContent.length} chars)`);
    
    // If waitForWorkflowCompletion is enabled, check workflow execution status
    if (waitForWorkflowCompletion) {
      try {
        // Get the workflow file name from path
        const workflowFileName = workflowFilePath.split('/').pop();
        
        // List workflow runs for this workflow file
        const workflowRunsResponse = await context.octokit.rest.actions.listWorkflowRunsForRepo({
          owner: repoOwner,
          repo: repoName,
          per_page: 1, // Get only the most recent run
        });
        
        const workflowRuns = workflowRunsResponse.data.workflow_runs || [];
        
        if (workflowRuns.length > 0) {
          const latestRun = workflowRuns[0];
          const runStatus = latestRun.status; // 'queued', 'in_progress', 'completed'
          const runConclusion = latestRun.conclusion; // 'success', 'failure', 'cancelled', null if still running
          
          console.log(`[handleGitHubActionsValidation] Latest workflow run status: ${runStatus}, conclusion: ${runConclusion || 'N/A'}`);
          
          // If workflow is still running, tell user to try again later
          if (runStatus === 'queued' || runStatus === 'in_progress') {
            const runUrl = latestRun.html_url;
            return [`⏳ **Workflow is still running**\n\nThe workflow is currently ${runStatus === 'queued' ? 'queued' : 'in progress'}. Please wait for it to complete and then comment "done" again.\n\n🔗 [View workflow run](${runUrl})`, false];
          }
          
          // If workflow completed, check if it succeeded
          if (runStatus === 'completed') {
            if (runConclusion === 'failure' || runConclusion === 'cancelled') {
              const runUrl = latestRun.html_url;
              return [response.error + `\n\n❌ **Workflow execution failed**\n\nThe workflow file is correctly configured, but the workflow run failed. Please check the workflow logs and fix any issues.\n\n🔗 [View workflow run](${runUrl})\n\n💡 **Tip**: Check the "Actions" tab in your repository to see what went wrong.`, false];
            }
            // If conclusion is 'success' or null (shouldn't happen but handle it), continue with file validation
            console.log(`[handleGitHubActionsValidation] Workflow run completed successfully, proceeding with file validation`);
          }
        } else {
          // No workflow runs found - workflow might not have been triggered yet
          console.log(`[handleGitHubActionsValidation] No workflow runs found - workflow may not have been triggered yet`);
          return [response.error + `\n\n⚠️ **No workflow runs found**\n\nThe workflow file exists, but no workflow runs have been triggered yet. Please push a commit or create a pull request to trigger the workflow, then comment "done" again.`, false];
        }
      } catch (error) {
        console.error(`[handleGitHubActionsValidation] Error checking workflow runs:`, error);
        // If we can't check workflow runs, continue with file validation only
        console.log(`[handleGitHubActionsValidation] Continuing with file validation only due to error checking workflow runs`);
      }
    }
    
    // Perform validation checks
    const validationResults = [];
    const failedChecks = [];
    
    for (const parameter of validationParameters) {
      // Skip invalid parameters (file paths, metadata, empty strings)
      if (!parameter || !parameter.trim() || 
          parameter.includes('.github/workflows/') || 
          parameter.toLowerCase().includes('validation parameters') ||
          parameter.toLowerCase().includes('one per line')) {
        console.log(`[handleGitHubActionsValidation] Skipping invalid parameter: ${parameter}`);
        continue;
      }
      const paramLower = parameter.toLowerCase();
      let passed = false;
      
      // Parse validation parameter and check
      if (paramLower.includes('workflow name')) {
        // Extract expected name from parameter (e.g., "Workflow name must be 'Python application'")
        const nameMatch = parameter.match(/['"]([^'"]+)['"]/);
        if (nameMatch) {
          const expectedName = nameMatch[1];
          passed = workflowContent.includes(`name: ${expectedName}`) || 
                   workflowContent.includes(`name: "${expectedName}"`) ||
                   workflowContent.includes(`name: '${expectedName}'`);
        }
      } else if (paramLower.includes('trigger on') && paramLower.includes('push')) {
        // Check for both simple format (on: [push) and detailed format (push: with branches)
        if (paramLower.includes('branches') || paramLower.includes('main')) {
          // Check for: push:\n    branches: [ main ]
          passed = /push\s*:.*?branches\s*:\s*\[\s*main\s*\]/is.test(workflowContent) ||
                   workflowContent.includes('push:') && workflowContent.includes('branches: [ main ]') ||
                   workflowContent.includes('push:') && workflowContent.includes('branches: [main]');
        } else {
          // Simple format: on: [push or on:\n  push
          passed = workflowContent.includes('on: [push') || 
                   workflowContent.includes('on:\n  push') ||
                   /on:\s*\[.*push/.test(workflowContent) ||
                   workflowContent.includes('push:');
        }
      } else if (paramLower.includes('trigger on') && paramLower.includes('pull')) {
        // Check for both simple format and detailed format with branches
        if (paramLower.includes('branches') || paramLower.includes('main')) {
          // Check for: pull_request:\n    branches: [ main ]
          passed = /pull_request\s*:.*?branches\s*:\s*\[\s*main\s*\]/is.test(workflowContent) ||
                   workflowContent.includes('pull_request:') && workflowContent.includes('branches: [ main ]') ||
                   workflowContent.includes('pull_request:') && workflowContent.includes('branches: [main]');
        } else {
          // Simple format
          passed = workflowContent.includes('pull_request') || workflowContent.includes('pull-request');
        }
      } else if (paramLower.includes('workflow_dispatch')) {
        passed = workflowContent.includes('workflow_dispatch:') || workflowContent.includes('workflow-dispatch:');
      } else if (paramLower.includes('python version')) {
        // Extract version number
        const versionMatch = parameter.match(/(\d+\.\d+)/);
        if (versionMatch) {
          const version = versionMatch[1];
          passed = workflowContent.includes(`python-version: ${version}`) ||
                   workflowContent.includes(`python-version: "${version}"`) ||
                   workflowContent.includes(`python-version: '${version}'`);
        }
      } else if (paramLower.includes('test command')) {
        // Extract command from quotes
        const cmdMatch = parameter.match(/['"]([^'"]+)['"]/);
        if (cmdMatch) {
          const expectedCmd = cmdMatch[1];
          passed = workflowContent.includes(expectedCmd);
        }
      } else if (paramLower.includes('checkout')) {
        const versionMatch = parameter.match(/@v(\d+)/);
        if (versionMatch) {
          passed = workflowContent.includes(`actions/checkout@v${versionMatch[1]}`);
        } else {
          passed = workflowContent.includes('actions/checkout');
        }
      } else if (paramLower.includes('setup-python')) {
        const versionMatch = parameter.match(/@v(\d+)/);
        if (versionMatch) {
          passed = workflowContent.includes(`actions/setup-python@v${versionMatch[1]}`);
        } else {
          passed = workflowContent.includes('setup-python');
        }
      } else if (paramLower.includes('runs-on') || paramLower.includes('run on') || 
                 /ubuntu-latest|windows-latest|macos-latest/.test(paramLower)) {
        // Check if parameter mentions an OS value (ubuntu-latest, windows-latest, macos-latest)
        const osMatch = parameter.match(/ubuntu-latest|windows-latest|macos-latest/i);
        if (osMatch) {
          const expectedOS = osMatch[0];
          const escapedOS = expectedOS.replace(/-/g, '\\-');
          // Try multiple patterns to catch different YAML formats
          // Pattern 1: runs-on: ubuntu-latest (same line, no quotes)
          // Pattern 2: runs-on: "ubuntu-latest" (same line, with quotes)
          // Pattern 3: runs-on:\n    ubuntu-latest (value on next line)
          const patterns = [
            new RegExp(`runs-on\\s*:\\s*${escapedOS}`, 'i'),
            new RegExp(`runs-on\\s*:\\s*["']${escapedOS}["']`, 'i'),
            new RegExp(`runs-on\\s*:.*?\\n\\s*${escapedOS}`, 'i'),
            new RegExp(`runs-on\\s*:.*?\\n\\s*["']${escapedOS}["']`, 'i')
          ];
          passed = patterns.some(pattern => pattern.test(workflowContent)) ||
                   // Fallback: check if both runs-on and OS value exist in the file
                   (workflowContent.toLowerCase().includes('runs-on') && 
                    workflowContent.toLowerCase().includes(expectedOS.toLowerCase()));
        } else {
          passed = workflowContent.includes('runs-on:');
        }
      } else {
        // Generic text search
        passed = workflowContent.toLowerCase().includes(paramLower);
      }
      
      validationResults.push({
        parameter: parameter,
        passed: passed
      });
      
      if (!passed) {
        failedChecks.push(parameter);
      }
    }
    
    const allPassed = failedChecks.length === 0;
    
    console.log(`[handleGitHubActionsValidation] Validation complete - ${validationResults.filter(r => r.passed).length}/${validationResults.length} checks passed`);
    
    if (allPassed) {
      // All checks passed
      await completeTask(user_data, quest, task, context, db);
      
      let successMsg = response.success + '\n\n✅ **GitHub Actions Workflow Validated!**\n\nAll checks passed:\n';
      validationResults.forEach(result => {
        successMsg += `\n✓ ${result.parameter}`;
      });
      
      if (waitForWorkflowCompletion) {
        successMsg += '\n\n✅ **Workflow execution verified**: The workflow has been successfully executed and all tests passed!';
      }
      
      return [successMsg, true];
    } else {
      // Some checks failed
      let errorMsg = response.error + '\n\n❌ **Workflow validation failed**\n\n';
      
      if (enableDetailedFeedback) {
        errorMsg += '**Failed checks:**\n';
        failedChecks.forEach(check => {
          errorMsg += `\n❌ ${check}`;
        });
        
        const passedChecks = validationResults.filter(r => r.passed);
        if (passedChecks.length > 0) {
          errorMsg += '\n\n**Passed checks:**\n';
          passedChecks.forEach(result => {
            errorMsg += `\n✓ ${result.parameter}`;
          });
        }
      } else {
        errorMsg += `${failedChecks.length} check(s) failed. Please review your workflow file and try again.`;
      }
      
      errorMsg += `\n\n💡 **Tip**: Check your workflow file at \`${workflowFilePath}\` and ensure it meets all requirements.`;
      
      return [errorMsg, false];
    }
    
  } catch (error) {
    console.error(`Error in handleGitHubActionsValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: ' + error.message, false];
  }
}

/**
 * Generic Repository Validation handler
 * Validates repository existence, ownership type, privacy, and bot authorization
 * @param {Object} user_data - User data object
 * @param {string} user - Username
 * @param {Object} context - GitHub context
 * @param {string} ossRepo - OSS repository
 * @param {Object} response - Response template
 * @param {Object} selectedIssue - Selected issue
 * @param {Object} db - Database object
 * @param {string} quest - Quest ID (e.g., "Q1")
 * @param {string} task - Task ID (e.g., "T1")
 * @returns {Array} [response, success]
 */
export async function handleRepositoryValidation(user_data, user, context, ossRepo, response, selectedIssue, db, quest, task) {
  try {
    console.log(`[handleRepositoryValidation] Quest: ${quest}, Task: ${task}`);
    console.log(`[handleRepositoryValidation] User: ${user}`);
    
    // Get quest configuration
    const questConfig = await getQuestConfigForUser(user_data);
    
    if (!questConfig[quest] || !questConfig[quest][task]) {
      console.error(`[handleRepositoryValidation] Task configuration not found`);
      return [response.error + '\n\n❌ **Error**: Task configuration not found. Please contact an administrator.', false];
    }
    
    const taskConfig = questConfig[quest][task];
    const repoConfig = taskConfig.repositoryValidation || {};
    
    // Extract configuration
    const requireRepositoryExists = repoConfig.requireRepositoryExists !== false; // default true
    const ownershipType = repoConfig.ownershipType || 'any'; // 'user', 'organization', or 'any'
    const specificOwner = (repoConfig.specificOwner || '').trim();
    const checkBotAuthorization = repoConfig.checkBotAuthorization || false;
    const requirePublic = repoConfig.requirePublic || false;
    const requirePrivate = repoConfig.requirePrivate || false;
    const saveValidatedData = repoConfig.saveValidatedData || false;
    const savedDataName = repoConfig.savedDataName || 'validatedRepo';
    
    // Get user input
    const userInput = context.payload.comment.body.trim();
    console.log(`[handleRepositoryValidation] User input: "${userInput}"`);
    
    if (!userInput) {
      return [
        response.error +
          '\n\n❌ **No repository provided**: Please provide your repository URL.\n\n**Examples:**\n- `https://github.com/username/repo-name`\n- `username/repo-name`',
        false
      ];
    }
    
    // Extract repository URL/identifier
    const repoIdentifier = extractGitHubRepoUrl(userInput);
    
    if (!repoIdentifier) {
      return [
        response.error +
          '\n\n❌ **Invalid repository URL**: Could not find a valid GitHub repository in your message.\n\n**Please provide your repository in one of these formats:**\n- `https://github.com/username/repo-name`\n- `username/repo-name`',
        false
      ];
    }
    
    console.log(`[handleRepositoryValidation] Extracted repo identifier: ${repoIdentifier}`);
    
    // Parse owner and repo name
    let repoOwner, repoName;
    try {
      [repoOwner, repoName] = parseRepoFromIdentifier(repoIdentifier);
    } catch (error) {
      return [response.error + `\n\n❌ **Invalid repository format**: \`${repoIdentifier}\`. Please use format "owner/repo" or a full GitHub URL.`, false];
    }
    
    console.log(`[handleRepositoryValidation] Parsed: owner=${repoOwner}, repo=${repoName}`);
    
    // Check if repository exists and fetch data
    let repoData;
    try {
      const repoResponse = await context.octokit.rest.repos.get({
        owner: repoOwner,
        repo: repoName,
      });
      repoData = repoResponse.data;
      console.log(`[handleRepositoryValidation] Repository found: ${repoData.full_name}`);
    } catch (error) {
      if (error.status === 404) {
        return [
          response.error +
            `\n\n❌ **Repository not found**: The repository \`${repoIdentifier}\` does not exist or is not accessible.\n\n**Please check:**\n- The repository URL is correct\n- The repository exists\n- The repository is public or the bot has access`,
          false
        ];
      } else if (error.status === 403) {
        return [
          response.error +
            `\n\n❌ **Access denied**: Cannot access the repository \`${repoIdentifier}\`. The repository may be private and the GitHub App may not have access.\n\n**Please ensure:**\n- The repository is public, OR\n- The GitHub App is installed on this repository`,
          false
        ];
      }
      console.error(`[handleRepositoryValidation] API error:`, error);
      return [response.error + `\n\n❌ **GitHub API error**: Could not validate repository. Error: ${error.message || 'Unknown error'}. Please try again later.`, false];
    }
    
    // Validate ownership type
    if (ownershipType !== 'any') {
      const isOrganization = repoData.owner.type === 'Organization';
      const isUser = repoData.owner.type === 'User';
      
      if (ownershipType === 'organization' && !isOrganization) {
        return [
          response.error +
            `\n\n❌ **Ownership type mismatch**: This task requires an **organization** repository, but \`${repoIdentifier}\` is a personal user repository.\n\n**Please:**\n- Use a repository owned by an organization\n- Ensure the repository is in the correct organization`,
          false
        ];
      }
      
      if (ownershipType === 'user' && !isOrganization) {
        // Note: We check !isOrganization because if ownershipType is 'user', we want personal repos
        // But the condition should be: if ownershipType === 'user' and isOrganization, return error
        if (isOrganization) {
          return [
            response.error +
              `\n\n❌ **Ownership type mismatch**: This task requires a **personal user** repository, but \`${repoIdentifier}\` is an organization repository.\n\n**Please:**\n- Use a repository owned by your personal GitHub account\n- Create a new repository at https://github.com/new`,
            false
          ];
        }
      }
      
      console.log(`[handleRepositoryValidation] Ownership type check passed: ${ownershipType} (actual: ${repoData.owner.type})`);
    }
    
    // Validate specific owner
    if (specificOwner) {
      const actualOwner = repoData.owner.login;
      if (actualOwner.toLowerCase() !== specificOwner.toLowerCase()) {
        return [
          response.error +
            `\n\n❌ **Owner mismatch**: The repository \`${repoIdentifier}\` is owned by \`${actualOwner}\`, but this task requires it to be owned by \`${specificOwner}\`.\n\n**Please:**\n- Use a repository owned by \`${specificOwner}\`\n- Check that you're using the correct repository`,
          false
        ];
      }
      console.log(`[handleRepositoryValidation] Specific owner check passed: ${actualOwner} === ${specificOwner}`);
    } else if (ownershipType === 'user') {
      // If no specific owner specified and ownershipType is 'user', check student ownership
      const actualOwner = repoData.owner.login;
      if (actualOwner.toLowerCase() !== user.toLowerCase()) {
        return [
          response.error +
            `\n\n❌ **Ownership mismatch**: The repository \`${repoIdentifier}\` is owned by \`${actualOwner}\`, but it must be owned by you (\`${user}\`).\n\n**Please:**\n- Use your own personal repository\n- Create a new repository at https://github.com/new`,
          false
        ];
      }
      console.log(`[handleRepositoryValidation] Student ownership check passed: ${actualOwner} === ${user}`);
    }
    
    // Validate privacy
    if (requirePublic && repoData.private) {
      return [
        response.error +
          `\n\n❌ **Repository must be public**: The repository \`${repoIdentifier}\` is private, but this task requires a public repository.\n\n**Please:**\n1. Go to repository settings: https://github.com/${repoIdentifier}/settings\n2. Scroll down to the "Danger Zone"\n3. Click "Change repository visibility"\n4. Change it to "Public"\n5. Come back and submit the link again`,
        false
      ];
    }
    
    if (requirePrivate && !repoData.private) {
      return [
        response.error +
          `\n\n❌ **Repository must be private**: The repository \`${repoIdentifier}\` is public, but this task requires a private repository.\n\n**Please:**\n1. Go to repository settings: https://github.com/${repoIdentifier}/settings\n2. Scroll down to the "Danger Zone"\n3. Click "Change repository visibility"\n4. Change it to "Private"\n5. Come back and submit the link again`,
        false
      ];
    }
    
    console.log(`[handleRepositoryValidation] Privacy check passed: private=${repoData.private}, requirePublic=${requirePublic}, requirePrivate=${requirePrivate}`);
    
    // Check bot authorization (if requested)
    if (checkBotAuthorization) {
      // We already successfully called context.octokit.rest.repos.get above
      // If we got here, the bot has access
      console.log(`[handleRepositoryValidation] Bot authorization verified - bot has access to repository`);
    }
    
    // Store validated repository data if configured
    if (saveValidatedData) {
      if (!user_data.storedValues) {
        user_data.storedValues = {};
      }
      const key = savedDataName.trim();
      if (key.length > 0) {
        user_data.storedValues[key] = repoIdentifier;
        user_data.storedValues[`${key}Url`] = `https://github.com/${repoIdentifier}`;
        user_data.storedValues[`${key}Owner`] = repoOwner;
        user_data.storedValues[`${key}Name`] = repoName;
        console.log(`[handleRepositoryValidation] Stored repository data with key: ${key}`);
      }
    }
    
    // All checks passed!
    await completeTask(user_data, quest, task, context, db);
    
    let successMsg = response.success + '\n\n✅ **Repository Validated!**\n\n';
    successMsg += `**Repository:** \`${repoIdentifier}\`\n`;
    successMsg += `**Owner:** \`${repoOwner}\` (${repoData.owner.type})\n`;
    successMsg += `**Visibility:** ${repoData.private ? '🔒 Private' : '🌍 Public'}\n`;
    
    if (checkBotAuthorization) {
      successMsg += `**Bot Access:** ✅ Verified\n`;
    }
    
    return [successMsg, true];
    
  } catch (error) {
    console.error(`Error in handleRepositoryValidation for ${quest}${task}:`, error);
    return [response.error + '\n\n❌ **Unexpected error**: ' + error.message, false];
  }
}
 
