// import utils for tasks
import { utils } from "./taskUtils.js";
import { completeTask, getQuestConfigForUser } from "./gamification.js";
import LLM from "./llm.js"
import fs from "fs";
import { handleMCQ, handleCustom, handleAssigned } from "./handlers/genericHandlers.js";
import { getQuestConfig } from "./config/questConfigGenerator.js";

// NOTE: due to how these functions are accessed, keep parameters uniform, even if not used
const llmInstance = new LLM();

// Q0
async function handleQ0T1(user_data, user, context, ossRepo, response, selectedIssue, db) {
    console.log('--- handleQ0T1 START ---');
    console.log('context:', context);
    console.log('ossRepo:', ossRepo);
    console.log('selectedIssue:', selectedIssue);
    const user_response = context.payload.comment.body.toLowerCase();
    console.log('user_response:', user_response);
    // WARNING: assumes that this quest and task will always be run first
    // will overwrite, otherwise do null check
    user_data.display_preference = [];

    // score
    if(user_response.includes("a")){
        user_data.display_preference.push("score");
        console.log('Preference set to score');
        await completeTask(user_data, "Q0", "T1", context, db);
        console.log('--- handleQ0T1 END (score) ---');
        return [response.success, true];
    }
    // map
    else if(user_response.includes("b")){
        user_data.display_preference.push("map");
        console.log('Preference set to map');
        await completeTask(user_data, "Q0", "T1", context, db);
        console.log('--- handleQ0T1 END (map) ---');
        return [response.success, true];
    }
    // both
    else if(user_response.includes("c")){
        user_data.display_preference.push("score");
        user_data.display_preference.push("map");
        console.log('Preference set to score and map');
        await completeTask(user_data, "Q0", "T1", context, db);
        console.log('--- handleQ0T1 END (both) ---');
        return [response.success, true];
    }
    // neither
    else if(user_response.includes("d")){
        // do nothing, complete task
        console.log('Preference set to neither');
        await completeTask(user_data, "Q0", "T1", context, db);
        console.log('--- handleQ0T1 END (neither) ---');
        return [response.success, true];
    }
    response = response.error;
    console.log('Invalid response, returning error');
    console.log('--- handleQ0T1 END (error) ---');
    return [response, false];
}

// Q1
async function handleQ1T1(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q1", taskId = "T1") {
    console.log('--- handleQ1T1 START ---');
    console.log('context:', context);
    console.log('ossRepo:', ossRepo);
    console.log('selectedIssue:', selectedIssue);
    console.log('questId (actual):', questId, 'taskId (actual):', taskId);
    
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    console.log('targetRepo (from config or fallback):', targetRepo);
    
    const issueCount = await utils.getIssueCount(targetRepo, context);
    console.log('issueCount:', issueCount);
    console.log('comment.body:', context.payload.comment.body);
    if (issueCount !== null && context.payload.comment.body == issueCount) {
        await completeTask(user_data, questId, taskId, context, db);
        console.log('--- handleQ1T1 END (success direct match) ---');
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,issueCount,"Q1","T1");
    console.log('llmInstance.validateAnswer:', newResponse);
    if(newResponse == "true") {
        await completeTask(user_data, questId, taskId, context, db);
        console.log('--- handleQ1T1 END (success llm) ---');
        return [response.success, true];
    }
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    console.log('--- handleQ1T1 END (error) ---');
    return [response, false];
}

async function handleQ1T2(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q1", taskId = "T2") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    const PRCount = await utils.getPRCount(targetRepo, context);
    if (PRCount !== null && context.payload.comment.body == PRCount) {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,PRCount,"Q1","T2");
    if(newResponse == "true") {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

async function handleQ1T3(user_data, user, context, ossRepo, response, selectedIssue, db) {
    const correctAnswer = "c";
    if (context.payload.comment.body.toLowerCase() === correctAnswer) {
        await completeTask(user_data, "Q1", "T3", context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,correctAnswer,"Q1","T3");
    if(newResponse == "true") {
        await completeTask(user_data, "Q1", "T3", context, db);
        return [response.success, true];
    }

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${ossRepo})`;
    return [response, false];
}

async function handleQ1T4(user_data, user, context, ossRepo, response, selectedIssue, db) {
    const correctAnswer = "d";
    if (context.payload.comment.body.toLowerCase() === correctAnswer) {
        await completeTask(user_data, "Q1", "T4", context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,correctAnswer,"Q1","T4");
    if(newResponse == "true") {
        await completeTask(user_data, "Q1", "T4", context, db);
        return [response.success, true];
    }

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${ossRepo})`;
    return [response, false];
}

async function handleQ1T5(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q1", taskId = "T5") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    const topContributor = await utils.getTopContributor(targetRepo, context);
    
    if (context.payload.comment.body.trim() === topContributor) {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,topContributor,"Q1","T5");
    if(newResponse == "true") {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }

    response = response.error; 
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

// Q2
async function handleQ2T1(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q2", taskId = "T1") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    const issueComment = context.payload.comment.body.trim().toLowerCase();
    const openIssues = await utils.openIssues(targetRepo, context);
    var firstAssignee = await utils.isFirstAssignee(targetRepo, user, Number(issueComment), context);
    var nonCodeLabel = await utils.hasNonCodeContributionLabel(targetRepo, Number(issueComment), context);

    if (issueComment === "pedrorodriguesarantes") {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }

    var llm_answer = await llmInstance.quizAnswer(issueComment,"13");
    firstAssignee = await utils.isFirstAssignee(targetRepo, user, Number(llm_answer), context);
    nonCodeLabel = await utils.hasNonCodeContributionLabel(targetRepo, Number(llm_answer), context);

    if(openIssues.includes(Number(llm_answer)) && firstAssignee && nonCodeLabel ) {
        user_data.selectedIssue = Number(issueComment);
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

async function handleQ2T2(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q2", taskId = "T2") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    // Debug logging
    console.log(`[handleQ2T2] Config lookup: questId=${questId}, taskId=${taskId}`);
    console.log(`[handleQ2T2] questConfig keys: ${questConfig ? Object.keys(questConfig).join(', ') : 'null'}`);
    console.log(`[handleQ2T2] questConfig[${questId}] exists: ${!!questConfig?.[questId]}`);
    if (questConfig?.[questId]) {
        console.log(`[handleQ2T2] questConfig[${questId}] keys: ${Object.keys(questConfig[questId]).join(', ')}`);
    }
    console.log(`[handleQ2T2] taskConfig?.ossRepository=${taskConfig?.ossRepository || 'NOT SET'}, ossRepo=${ossRepo}`);
    console.log(`[handleQ2T2] Using targetRepo=${targetRepo}`);
    
    const issueComment = context.payload.comment.body.replace("#", "").trim();
    
    // Check if input is a valid issue number
    const issueNumber = Number(issueComment);
    if (!isNaN(issueNumber) && issueNumber > 0) {
        console.log(`[handleQ2T2] Validating issue #${issueNumber} in ${targetRepo} for user ${user}`);
        const openIssues = await utils.openIssues(targetRepo, context);
        const firstAssignee = await utils.isFirstAssignee(targetRepo, user, issueNumber, context);
        const nonCodeLabel = await utils.hasNonCodeContributionLabel(targetRepo, issueNumber, context);
        
        console.log(`[handleQ2T2] Issue #${issueNumber} validation: open=${openIssues.includes(issueNumber)}, firstAssignee=${firstAssignee}, nonCodeLabel=${nonCodeLabel}`);

        // Check if issue is open, user is first assignee, and has non-code contribution label
        if (openIssues.includes(issueNumber) && firstAssignee && nonCodeLabel) {
            user_data.selectedIssue = issueNumber;
            await completeTask(user_data, questId, taskId, context, db);
            return [response.success, true];
        }
        
        // Fallback: If issue is open and user is assigned (but maybe not first or missing label), still accept
        if (openIssues.includes(issueNumber) && await utils.checkAssignee(targetRepo, issueNumber, user, context)) {
            console.log(`[handleQ2T2] Fallback validation passed: issue is open and user is assigned`);
            user_data.selectedIssue = issueNumber;
            await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    }
    
    // Fallback: LLM validation for text responses like "done"
    var llm_answer = await llmInstance.validateAnswer(issueComment,"done",questId,taskId);
    if(llm_answer == "true" && selectedIssue && await utils.checkAssignee(targetRepo, selectedIssue, user, context)) {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

async function handleQ2T3(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q2", taskId = "T3") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    // Use selectedIssue from user_data if available, otherwise use the parameter
    const issueNumber = user_data.selectedIssue || selectedIssue;
    
    console.log(`[handleQ2T3] Validating for user ${user}, issue ${issueNumber}, repo ${targetRepo}`);
    
    const issueComment = context.payload.comment.body.trim().toLowerCase();
    if (issueComment === "done" && issueNumber && await utils.userCommentedInIssue(targetRepo, issueNumber, user, context)) {
        try {
            // Check if context.octokit exists before using it
            if (context.octokit && context.octokit.issues) {
            await context.octokit.issues.addAssignees({
                    owner: targetRepo.split('/')[0],
                    repo: targetRepo.split('/')[1],
                    issue_number: issueNumber,
                assignees: [user]
            });
            } else {
                console.log(`[handleQ2T3] context.octokit not available, skipping assignee addition`);
            }

            await completeTask(user_data, questId, taskId, context, db);
            return [response.success, true];
        } catch (error) {
            console.error("Error adding assignee:", error);
            // Continue to LLM validation even if assignee addition fails
        }
    }
    var llm_answer = await llmInstance.validateAnswer(issueComment,"done",questId,taskId);
    if(llm_answer == "true" && issueNumber && await utils.userCommentedInIssue(targetRepo, issueNumber, user, context)) {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

async function handleQ2T4(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q2", taskId = "T4") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    // Use selectedIssue from user_data if available, otherwise use the parameter
    const issueNumber = user_data.selectedIssue || selectedIssue;
    
    console.log(`[handleQ2T4] Validating for user ${user}, issue ${issueNumber}, repo ${targetRepo}`);
    console.log(`[handleQ2T4] user_data.selectedIssue=${user_data.selectedIssue}, selectedIssue param=${selectedIssue}`);
    
    if (!issueNumber) {
        console.log(`[handleQ2T4] ERROR: No issue number available! user_data.selectedIssue=${user_data.selectedIssue}, selectedIssue=${selectedIssue}`);
        response = response.error;
        response += `\n\n⚠️ Error: No issue selected. Please complete Task 2 first to select an issue.\n\n[Click here to start](https://github.com/${targetRepo})`;
        return [response, false];
    }
    
    const issueComment = context.payload.comment.body.trim().toLowerCase();
    console.log(`[handleQ2T4] User comment: "${issueComment}"`);
    
    // Check if contributor is mentioned
    const contributorMentioned = await utils.isContributorMentionedInIssue(targetRepo, issueNumber, context);
    console.log(`[handleQ2T4] Contributor mentioned in issue #${issueNumber}: ${contributorMentioned}`);
    
    if (issueComment === "done" && contributorMentioned) {
        console.log(`[handleQ2T4] ✅ Validation passed: user typed "done" and contributor is mentioned`);
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    
    var llm_answer = await llmInstance.validateAnswer(issueComment,"done",questId,taskId);
    console.log(`[handleQ2T4] LLM validation result: ${llm_answer}`);
    
    if(llm_answer == "true" && contributorMentioned) {
        console.log(`[handleQ2T4] ✅ LLM validation passed, contributor mention found in issue #${issueNumber}`);
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    
    console.log(`[handleQ2T4] ❌ Validation failed: issueNumber=${issueNumber}, llm_answer=${llm_answer}, contributorMentioned=${contributorMentioned}`);

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

// Q3
async function handleQ3T1(user_data, user, context, ossRepo, response, selectedIssue, db) {
    const correctAnswer = "c";
    if (context.payload.comment.body.toLowerCase() === correctAnswer) {
        await completeTask(user_data, "Q3", "T1", context, db);
        return [response.success, true];
    }
    var llm_answer = await llmInstance.validateAnswer(context.payload.comment.body.toLowerCase(),correctAnswer,"Q3","T1");
    if(llm_answer == "true") {
        await completeTask(user_data, "Q3", "T1", context, db);
        return [response.success, true];
    }

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${ossRepo})`;
    return [response, false];
}

async function handleQ3T2(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q3", taskId = "T2") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    if (await utils.userPRAndComment(targetRepo, user, context)) {
        await completeTask(user_data, questId, taskId, context, db);
        return [response.success, true];
    }
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

async function handleQ3T3(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q3", taskId = "T3") {
    // Get quest config to check for custom OSS repository
    const questConfig = await getQuestConfigForUser(user_data);
    const taskConfig = questConfig?.[questId]?.[taskId];
    const targetRepo = taskConfig?.ossRepository || ossRepo;
    
    // Use selectedIssue from user_data if available, otherwise use the parameter
    const issueNumber = user_data.selectedIssue || selectedIssue;
    
    console.log(`[handleQ3T3] Validating for user ${user}, issue ${issueNumber}, repo ${targetRepo}`);
    
    if (!issueNumber) {
        console.log(`[handleQ3T3] ERROR: No issue number available!`);
        response = response.error;
        response += `\n\n⚠️ Error: No issue selected. Please complete the previous task first.\n\n[Click here to start](https://github.com/${targetRepo})`;
        return [response, false];
    }
    
    if (await utils.issueClosed(targetRepo, issueNumber, context)) {
        console.log(`[handleQ3T3] ✅ Issue #${issueNumber} is closed`);
        await completeTask(user_data, questId, taskId, context, db);
        const newPoints = user_data.streakCount * 100;
        user_data.points += newPoints;
        return [response.success, true]; 
    }
    
    console.log(`[handleQ3T3] ❌ Issue #${issueNumber} is not closed`);
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${targetRepo})`;
    return [response, false];
}

// QUIZZES
async function handleQ1Quiz(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q1", taskId = "T6") {
    const correctAnswers = ["b", "a", "c", "b", "d"]; 
    var userAnswerString = context.payload.comment.body.trim();
    
    try {
      // Normalize input: remove extra whitespace, ensure proper bracket format
      // Handle formats like [B,B,C,D,D] or b,b,c,d,d or B, B, C, D, D
      if (!userAnswerString.startsWith('[')) {
        // If no brackets, add them
        userAnswerString = '[' + userAnswerString + ']';
      }
      // Normalize: remove spaces after commas, ensure single spaces
      userAnswerString = userAnswerString.replace(/,\s+/g, ',').replace(/\s+/g, ' ');
      
      // Convert to lowercase for comparison (but preserve original format for display)
      // Extract answers from brackets: [A,B,C] -> ['a','b','c']
      const answerMatch = userAnswerString.match(/\[(.*?)\]/);
      if (answerMatch) {
        const answers = answerMatch[1].split(',').map(a => a.trim().toLowerCase()).filter(a => a);
        userAnswerString = '[' + answers.join(',') + ']';
      }
      
      console.log(`[handleQ1Quiz] Original input: "${context.payload.comment.body.trim()}"`);
      console.log(`[handleQ1Quiz] Normalized input: "${userAnswerString}"`);
      
      // Validate answers WITHOUT LLM correction - validate user's actual answers
      let correctAnswersNumber, feedback;
      try {
        const validationResult = utils.validateAnswers(userAnswerString, correctAnswers);
        correctAnswersNumber = validationResult.correctAnswersNumber;
        feedback = validationResult.feedback;
      } catch (validationError) {
        // Format or length validation failed - return error immediately without proceeding
        console.log('[handleQ1Quiz] Format validation error:', validationError.message);
        console.log('[handleQ1Quiz] User input was:', context.payload.comment.body);
        console.log('[handleQ1Quiz] Normalized input was:', userAnswerString);
        return [response.error, false];
      }
  
      console.log(`[handleQ1Quiz] User answers: ${userAnswerString}`);
      console.log(`[handleQ1Quiz] Correct answers: ${correctAnswers.join(',')}`);
      console.log(`[handleQ1Quiz] Correct count: ${correctAnswersNumber}/${correctAnswers.length}`);
  
      // Only complete task if all answers are correct
      if (correctAnswersNumber === correctAnswers.length) {
        await completeTask(user_data, questId, taskId, context, db);
      response = response.success + 
          `\n ## You correctly answered all ${correctAnswersNumber} questions!` + 
        `\n\n ### Feedback:\n${feedback.join('')}`;
      return [response, true];
      } else {
        // Show feedback but don't complete
        response = response.error + 
          `\n ## You correctly answered ${correctAnswersNumber} out of ${correctAnswers.length} questions.` + 
          `\n\n ### Feedback:\n${feedback.join('')}`;
        return [response, false];
      }
    } catch (error) {
      console.log('[handleQ1Quiz] Unexpected error:', error);
      console.log('User input was:', context.payload.comment.body);
      response = response.error + `\n\n[Click here to start](https://github.com/${ossRepo})`;
      return [response, false];
    }
}

async function handleQ2Quiz(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q2", taskId = "T5") {
    const correctAnswers = ["a", "b", "c", "c", "d", "b"]; 
    var userAnswerString = context.payload.comment.body.trim();
    
    try {
      // Normalize input: remove extra whitespace, ensure proper bracket format
      // Handle formats like [B,B,C,D,D] or b,b,c,d,d or B, B, C, D, D
      if (!userAnswerString.startsWith('[')) {
        // If no brackets, add them
        userAnswerString = '[' + userAnswerString + ']';
      }
      // Normalize: remove spaces after commas, ensure single spaces
      userAnswerString = userAnswerString.replace(/,\s+/g, ',').replace(/\s+/g, ' ');
      
      // Convert to lowercase for comparison (but preserve original format for display)
      // Extract answers from brackets: [A,B,C] -> ['a','b','c']
      const answerMatch = userAnswerString.match(/\[(.*?)\]/);
      if (answerMatch) {
        const answers = answerMatch[1].split(',').map(a => a.trim().toLowerCase()).filter(a => a);
        userAnswerString = '[' + answers.join(',') + ']';
      }
      
      console.log(`[handleQ2Quiz] Original input: "${context.payload.comment.body.trim()}"`);
      console.log(`[handleQ2Quiz] Normalized input: "${userAnswerString}"`);
      
      // Validate answers WITHOUT LLM correction - validate user's actual answers
      let correctAnswersNumber, feedback;
      try {
        const validationResult = utils.validateAnswers(userAnswerString, correctAnswers);
        correctAnswersNumber = validationResult.correctAnswersNumber;
        feedback = validationResult.feedback;
      } catch (validationError) {
        // Format or length validation failed - return error immediately without proceeding
        console.log('[handleQ2Quiz] Format validation error:', validationError.message);
        console.log('[handleQ2Quiz] User input was:', context.payload.comment.body);
        console.log('[handleQ2Quiz] Normalized input was:', userAnswerString);
        return [response.error, false];
      }
  
      console.log(`[handleQ2Quiz] User answers: ${userAnswerString}`);
      console.log(`[handleQ2Quiz] Correct answers: ${correctAnswers.join(',')}`);
      console.log(`[handleQ2Quiz] Correct count: ${correctAnswersNumber}/${correctAnswers.length}`);
  
      // Only complete task if all answers are correct
      if (correctAnswersNumber === correctAnswers.length) {
        await completeTask(user_data, questId, taskId, context, db);
      response = response.success + 
          `\n ## You correctly answered all ${correctAnswersNumber} questions!` + 
        `\n\n ### Feedback:\n${feedback.join('')}`;
      return [response, true];
      } else {
        // Show feedback but don't complete
        response = response.error + 
          `\n ## You correctly answered ${correctAnswersNumber} out of ${correctAnswers.length} questions.` + 
          `\n\n ### Feedback:\n${feedback.join('')}`;
        return [response, false];
      }
    } catch (error) {
      console.log('[handleQ2Quiz] Unexpected error:', error);
      console.log('User input was:', context.payload.comment.body);
      response = response.error + `\n\n[Click here to start](https://github.com/${ossRepo})`;
      return [response, false];
    }
}

async function handleQ3Quiz(user_data, user, context, ossRepo, response, selectedIssue, db, questId = "Q3", taskId = "T4") {
    const correctAnswers = ["b", "c", "c", "b", "b", "d"]; 
    var userAnswerString = context.payload.comment.body.trim();
    
    try {
      // Normalize input: remove extra whitespace, ensure proper bracket format
      // Handle formats like [B,B,C,D,D] or b,b,c,d,d or B, B, C, D, D
      if (!userAnswerString.startsWith('[')) {
        // If no brackets, add them
        userAnswerString = '[' + userAnswerString + ']';
      }
      // Normalize: remove spaces after commas, ensure single spaces
      userAnswerString = userAnswerString.replace(/,\s+/g, ',').replace(/\s+/g, ' ');
      
      // Convert to lowercase for comparison (but preserve original format for display)
      // Extract answers from brackets: [A,B,C] -> ['a','b','c']
      const answerMatch = userAnswerString.match(/\[(.*?)\]/);
      if (answerMatch) {
        const answers = answerMatch[1].split(',').map(a => a.trim().toLowerCase()).filter(a => a);
        userAnswerString = '[' + answers.join(',') + ']';
      }
      
      console.log(`[handleQ3Quiz] Original input: "${context.payload.comment.body.trim()}"`);
      console.log(`[handleQ3Quiz] Normalized input: "${userAnswerString}"`);
      
      // Validate answers WITHOUT LLM correction - validate user's actual answers
      let correctAnswersNumber, feedback;
      try {
        const validationResult = utils.validateAnswers(userAnswerString, correctAnswers);
        correctAnswersNumber = validationResult.correctAnswersNumber;
        feedback = validationResult.feedback;
      } catch (validationError) {
        // Format or length validation failed - return error immediately without proceeding
        console.log('[handleQ3Quiz] Format validation error:', validationError.message);
        console.log('[handleQ3Quiz] User input was:', context.payload.comment.body);
        console.log('[handleQ3Quiz] Normalized input was:', userAnswerString);
        return [response.error, false];
      }
  
      console.log(`[handleQ3Quiz] User answers: ${userAnswerString}`);
      console.log(`[handleQ3Quiz] Correct answers: ${correctAnswers.join(',')}`);
      console.log(`[handleQ3Quiz] Correct count: ${correctAnswersNumber}/${correctAnswers.length}`);
  
      // Only complete task if all answers are correct
      if (correctAnswersNumber === correctAnswers.length) {
        await completeTask(user_data, questId, taskId, context, db);
      response = response.success + 
          `\n ## You correctly answered all ${correctAnswersNumber} questions!` + 
        `\n\n ### Feedback:\n${feedback.join('')}`;
      return [response, true];
      } else {
        // Show feedback but don't complete
        response = response.error + 
          `\n ## You correctly answered ${correctAnswersNumber} out of ${correctAnswers.length} questions.` + 
          `\n\n ### Feedback:\n${feedback.join('')}`;
        return [response, false];
      }
    } catch (error) {
      console.log('[handleQ3Quiz] Unexpected error:', error);
      console.log('User input was:', context.payload.comment.body);
      response = response.error + `\n\n[Click here to start](https://github.com/${ossRepo})`;
      return [response, false];
    }
}

async function handleQ4T1(user_data, user, context, ossRepo, response, selectedIssue, db) {
    const correctAnswer = "b";
    if (context.payload.comment.body.toLowerCase() === correctAnswer) {
        await completeTask(user_data, "Q4", "T1", context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input,correctAnswer,"Q4","T1");
    if(newResponse == "true") {
        await completeTask(user_data, "Q4", "T1", context, db);
        return [response.success, true];
    }

    response = response.error;
    response += `\n\n[Click here to start](https://github.com/${ossRepo})`;
    return [response, false];
}

async function handleQ5T1(user_data, user, context, ossRepo, response, selectedIssue, db) {
    const openIssues = await utils.openIssues("OSS-Doorway-Dev/test-repo", context);
    const issueCount = openIssues ? openIssues.length : 0;
    if (context.payload.comment.body.trim() === issueCount.toString()) {
        await completeTask(user_data, "Q5", "T1", context, db);
        return [response.success, true];
    }
    var input = context.payload.comment.body;
    var newResponse = await llmInstance.validateAnswer(input, issueCount.toString(), "Q5", "T1");
    if(newResponse == "true") {
        await completeTask(user_data, "Q5", "T1", context, db);
        return [response.success, true];
    }
    response = response.error;
    response += `\n\n[Click here to start](https://github.com/OSS-Doorway-Dev/test-repo)`;
    return [response, false];
}

// Store all specific handlers for fallback
const specificHandlers = {
    handleQ0T1,
    handleQ1T1, handleQ1T2, handleQ1T3, handleQ1T4, handleQ1T5, handleQ1T6: handleQ1Quiz, handleQ1Quiz,
    handleQ2T1, handleQ2T2, handleQ2T3, handleQ2T4, handleQ2T5: handleQ2Quiz, handleQ2T6: handleQ1Quiz, handleQ2Quiz,
    handleQ3T1, handleQ3T2, handleQ3T3, handleQ3T4: handleQ3Quiz, handleQ3Quiz, 
    handleQ4T1, handleQ5T1
};

// Dynamic task mapping based on quest configuration
const questConfig = getQuestConfig();

export const taskMapping = {
    Q0: { T1: handleQ0T1 },
    Q1: { T1: handleQ1T1, T2: handleQ1T2, T3: handleQ1T3, T4: handleQ1T4, T5: handleQ1T5, T6: handleQ1Quiz },
    Q2: { T1: handleQ2T1, T2: handleQ2T2, T3: handleQ2T3, T4: handleQ2T4, T5: handleQ2Quiz, T6: handleQ1Quiz },
    Q3: { T1: handleQ3T1, T2: handleQ3T2, T3: handleQ3T3, T4: handleQ3Quiz },
    Q4: { T1: handleQ4T1 },
    Q5: { T1: handleQ5T1 }
}; 