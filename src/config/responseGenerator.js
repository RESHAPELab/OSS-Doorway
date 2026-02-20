import fs from 'fs';
import { getQuestConfig, getQuestSequence as getQuestSequenceFromConfig } from './questConfigGenerator.js';

/**
 * Response Generator - Extracts responses from quest-sequence.json
 * Replaces the need for response.json by providing the same interface
 */

// Cache for quest sequence data
let questSequenceCache = null;
let customGroupCache = {};

/**
 * Get the quest sequence data, with caching for performance
 * @param {string} groupId - Optional group ID for custom sequences
 */
function getQuestSequence(groupId = null) {
    // If groupId is provided, use custom group cache
    if (groupId) {
        if (!customGroupCache[groupId]) {
            try {
                const groupConfigPath = `./src/config/generated/quest_config_${groupId}.json`;
                if (fs.existsSync(groupConfigPath)) {
                    const configData = JSON.parse(fs.readFileSync(groupConfigPath, 'utf8'));
                    
                    // Check if this is legacy format (direct quest objects) or new format (questSequence array)
                    if (configData.questSequence) {
                        // New format - use as is
                        customGroupCache[groupId] = configData;
                    } else {
                        // Legacy format - convert to new format for response generator
                        const convertedData = {
                            questSequence: []
                        };
                        
                        // Convert each quest from legacy format to new format
                        Object.keys(configData).forEach(key => {
                            if (key !== 'map_repo_link') {
                                const quest = configData[key];
                                const { metadata, ...tasks } = quest; // Extract metadata and separate tasks
                                
                                console.log(`[getQuestSequence] Converting quest ${key}:`, {
                                    originalKeys: Object.keys(quest),
                                    metadataKeys: metadata ? Object.keys(metadata) : 'no metadata',
                                    taskKeys: Object.keys(tasks)
                                });
                                
                                convertedData.questSequence.push({
                                    questId: key,
                                    title: metadata?.title || key,
                                    metadata: metadata,
                                    tasks: tasks // Now tasks only contains the actual task data
                                });
                            }
                        });
                        
                        customGroupCache[groupId] = convertedData;
                    }
                } else {
                    console.warn(`Group config not found: ${groupConfigPath}, falling back to default`);
                    customGroupCache[groupId] = getQuestSequenceFromConfig();
                }
            } catch (error) {
                console.error(`Error loading custom group config for ${groupId}:`, error);
                customGroupCache[groupId] = getQuestSequenceFromConfig();
            }
        }
        return customGroupCache[groupId];
    }
    
    // Use default quest sequence
    if (!questSequenceCache) {
        questSequenceCache = getQuestSequenceFromConfig();
    }
    return questSequenceCache;
}

/**
 * Get a specific quest response for a task
 * @param {string} questId - The quest ID (e.g., 'Q1', 'Q2')
 * @param {string} taskId - The task ID (e.g., 'T1', 'T2')
 * @param {string} responseType - The type of response ('accept', 'success', 'error', 'hints', 'noHints')
 * @param {string} groupId - Optional group ID for custom sequences
 * @returns {string|null} The response text or null if not found
 */
export function getQuestResponse(questId, taskId, responseType, groupId = null) {
    try {
        const questSequence = getQuestSequence(groupId);
        const quest = questSequence.questSequence.find(q => q.questId === questId);
        
        if (!quest || !quest.tasks || !quest.tasks[taskId]) {
            return null;
        }
        
        const task = quest.tasks[taskId];
        return task[responseType] || null;
    } catch (error) {
        console.error(`Error getting quest response for ${questId}.${taskId}.${responseType}:`, error);
        return null;
    }
}

/**
 * Get all responses for a specific quest and task
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @param {string} groupId - Optional group ID for custom sequences
 * @returns {object} Object containing all response types for the task
 */
export function getTaskResponses(questId, taskId, groupId = null) {
    try {
        const questSequence = getQuestSequence(groupId);
        const quest = questSequence.questSequence.find(q => q.questId === questId);
        
        if (!quest || !quest.tasks || !quest.tasks[taskId]) {
            return null;
        }
        
        const taskData = quest.tasks[taskId];
        
        // Automatically concatenate quiz content if this is a quiz task
        if (taskData.type === 'quiz' && taskData.questions && Array.isArray(taskData.questions)) {
            // Build the quiz content from structured data
            let quizContent = `### 🧠 Quiz\n\n`;
            
            // Add quest metadata if available
            if (quest.metadata && quest.metadata.title) {
                quizContent += `**Quest:** ${quest.metadata.title}\n\n`;
            }
            if (quest.metadata && quest.metadata.description) {
                quizContent += `**Description:** ${quest.metadata.description}\n\n`;
            }
            
            // Add instructions
            quizContent += `**Instructions:** Answer all questions and submit your answers in the format [a,b,c,d,e] where each letter corresponds to your answer for each question.\n\n`;
            quizContent += `**Example:** If you think the answers are A, C, B, D, E, type: [a,c,b,d,e]\n\n`;
            
            // Add each question
            taskData.questions.forEach((question, index) => {
                if (question.question) {
                    quizContent += `**Question ${index + 1}:** ${question.question}\n\n`;
                    if (question.optionA) quizContent += `A) ${question.optionA}\n`;
                    if (question.optionB) quizContent += `B) ${question.optionB}\n`;
                    if (question.optionC) quizContent += `C) ${question.optionC}\n`;
                    if (question.optionD) quizContent += `D) ${question.optionD}\n`;
                    quizContent += `\n`;
                }
            });
            
            // Add submission instructions
            quizContent += `Submit your answers in the format [a,b,c,d,e] where each letter is your answer choice.`;
            
            // Return the task data with the concatenated accept field
            return {
                ...taskData,
                accept: quizContent
            };
        }
        
        return taskData;
    } catch (error) {
        console.error(`Error getting task responses for ${questId}.${taskId}:`, error);
        return null;
    }
}

/**
 * Get general responses (like newIssue, invalidCommand, etc.)
 * These are kept in a separate section or can be moved to quest-sequence.json
 * @returns {object} Object containing general responses
 */
export function getGeneralResponses() {
    return {
        newIssue: "You have opened a new issue, available commands are:\n/create_repos <list of users (u1, u2, u3)>, sets up the environment for a list of github users and invites them\n/new_user (user), creates new user in database\n/del_user (user), deletes user in database\n/reset_repo (repo/user), resets the readme of the specified repo\n/del_repo (repo), deletes user's repo",
        invalidCommand: "Invalid command! Available commands: \n/create_repos <list of users (u1, u2, u3)>, sets up the environment for a list of github users and invites them\n/new_user (user), creates new user in database\n/del_user (user), deletes user in database\n/reset_repo (repo/user), resets the readme of the specified repo\n/del_repo (repo), deletes user's repo",
        failedAccept: "Quest failed to accept, please ensure you are not already on a quest.",
        taskAbandoned: "### Task Abandoned\n\n🛑 **Whoa, Adventurer!** 🛑\n\nIt seems you've decided to abandon your current task. \n\nWhile every quest offers its rewards and challenges, remember that true growth often lies just beyond the trials we choose to face.\n\nIf this task no longer aligns with your journey or if you seek a different challenge, that's perfectly okay. \n\nExploration is not just about the paths we complete but also about understanding which directions resonate most with our goals and interests.\n\nShould you wish to embark on a new adventure, the realm of GitHub awaits with open arms and endless possibilities. When ready, a new quest is automatically created in the **issues tab**, and let's turn the page to your next chapter in this grand adventure.\n\nRemember, the journey of a thousand lines of code begins with a single command. Your next quest is just a command away!",
        newUserResponse: "user created."
    };
}

/**
 * Get the complete response object in the same format as the old response.json
 * This maintains backward compatibility
 * @returns {object} Complete response object matching the old response.json structure
 */
export function getCompleteResponseObject() {
    try {
        const questSequence = getQuestSequence();
        const generalResponses = getGeneralResponses();
        
        // Build the response object in the same structure as the old response.json
        const responseObject = {
            responses: generalResponses
        };
        
        // Add quest responses
        questSequence.questSequence.forEach(quest => {
            responseObject[quest.questId] = {};
            
            Object.keys(quest.tasks).forEach(taskId => {
                responseObject[quest.questId][taskId] = quest.tasks[taskId];
            });
        });
        
        return responseObject;
    } catch (error) {
        console.error('Error building complete response object:', error);
        return { responses: getGeneralResponses() };
    }
}

/**
 * Clear the cache (useful for testing or when quest-sequence.json is updated)
 */
export function clearCache() {
    questSequenceCache = null;
}

/**
 * Check if a quest and task exists
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {boolean} True if the quest and task exist
 */
export function questTaskExists(questId, taskId) {
    try {
        const questSequence = getQuestSequence();
        const quest = questSequence.questSequence.find(q => q.questId === questId);
        return !!(quest && quest.tasks && quest.tasks[taskId]);
    } catch (error) {
        console.error(`Error checking if quest task exists ${questId}.${taskId}:`, error);
        return false;
    }
}

/**
 * Get detailed hints for a specific quest and task
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {array|null} Array of detailed hint objects or null if not found
 */
export function getDetailedHints(questId, taskId) {
    try {
        const questSequence = getQuestSequence();
        const quest = questSequence.questSequence.find(q => q.questId === questId);
        
        if (!quest || !quest.tasks || !quest.tasks[taskId]) {
            return null;
        }
        
        const task = quest.tasks[taskId];
        return task.detailedHints || null;
    } catch (error) {
        console.error(`Error getting detailed hints for ${questId}.${taskId}:`, error);
        return null;
    }
}

/**
 * Get a specific detailed hint by sequence number
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @param {number} sequence - The hint sequence number (1, 2, 3, etc.)
 * @returns {object|null} The detailed hint object or null if not found
 */
export function getDetailedHintBySequence(questId, taskId, sequence) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        if (!detailedHints) {
            return null;
        }
        
        return detailedHints.find(hint => hint.sequence === sequence) || null;
    } catch (error) {
        console.error(`Error getting detailed hint by sequence for ${questId}.${taskId}.${sequence}:`, error);
        return null;
    }
}

/**
 * Check if a quest and task has detailed hints
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {boolean} True if the quest and task has detailed hints
 */
export function hasDetailedHints(questId, taskId) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        return !!(detailedHints && detailedHints.length > 0);
    } catch (error) {
        console.error(`Error checking if quest task has detailed hints ${questId}.${taskId}:`, error);
        return false;
    }
} 