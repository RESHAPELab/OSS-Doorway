import fs from 'fs';
import { getQuestConfig } from './questConfigGenerator.js';

/**
 * Hint Generator - Extracts detailed hints from quest-sequence.json
 * Replaces the need for database hint storage by providing the same interface
 */

// Cache for quest sequence data
let questSequenceCache = null;

/**
 * Get the quest sequence data, with caching for performance
 */
function getQuestSequence() {
    if (!questSequenceCache) {
        const questSequencePath = './src/config/quest-sequence.json';
        questSequenceCache = JSON.parse(fs.readFileSync(questSequencePath, 'utf-8'));
    }
    return questSequenceCache;
}

/**
 * Get detailed hints for a specific quest and task
 * @param {string} questId - The quest ID (e.g., 'Q1', 'Q2')
 * @param {string} taskId - The task ID (e.g., 'T1', 'T2')
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
 * Get a specific hint by sequence number (replaces db.findHintResponse)
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @param {number} sequence - The hint sequence number (1, 2, 3, etc.)
 * @returns {object|null} The hint object with content, image, video, penalty, or null if not found
 */
export function getHintBySequence(questId, taskId, sequence) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        if (!detailedHints) {
            return null;
        }
        
        const hint = detailedHints.find(h => h.sequence === sequence);
        if (!hint) {
            return null;
        }
        
        // Format the response similar to the old database format
        let response = hint.content;
        if (hint.image) {
            response += `\n![image](${hint.image})`;
        }
        
        return {
            content: response,
            penalty: hint.penalty || 5,
            image: hint.image,
            video: hint.video,
            sequence: hint.sequence
        };
    } catch (error) {
        console.error(`Error getting hint by sequence for ${questId}.${taskId}.${sequence}:`, error);
        return null;
    }
}

/**
 * Get the total number of hints available for a quest/task
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {number} Number of available hints
 */
export function getHintCount(questId, taskId) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        return detailedHints ? detailedHints.length : 0;
    } catch (error) {
        console.error(`Error getting hint count for ${questId}.${taskId}:`, error);
        return 0;
    }
}

/**
 * Check if a specific hint sequence exists
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @param {number} sequence - The hint sequence number
 * @returns {boolean} True if the hint exists
 */
export function hintExists(questId, taskId, sequence) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        if (!detailedHints) {
            return false;
        }
        
        return detailedHints.some(hint => hint.sequence === sequence);
    } catch (error) {
        console.error(`Error checking if hint exists for ${questId}.${taskId}.${sequence}:`, error);
        return false;
    }
}

/**
 * Get all hints for a quest/task as a formatted string (for debugging/logging)
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {string} Formatted string of all hints
 */
export function getAllHintsFormatted(questId, taskId) {
    try {
        const detailedHints = getDetailedHints(questId, taskId);
        if (!detailedHints || detailedHints.length === 0) {
            return `No hints available for ${questId}.${taskId}`;
        }
        
        return detailedHints.map(hint => 
            `Hint ${hint.sequence}: ${hint.content.substring(0, 100)}...`
        ).join('\n');
    } catch (error) {
        console.error(`Error formatting hints for ${questId}.${taskId}:`, error);
        return `Error retrieving hints for ${questId}.${taskId}`;
    }
}

/**
 * Clear the cache (useful for testing or when quest-sequence.json is updated)
 */
export function clearCache() {
    questSequenceCache = null;
}

/**
 * Get quest and task information for hint context
 * @param {string} questId - The quest ID
 * @param {string} taskId - The task ID
 * @returns {object|null} Quest and task information
 */
export function getQuestTaskInfo(questId, taskId) {
    try {
        const questSequence = getQuestSequence();
        const quest = questSequence.questSequence.find(q => q.questId === questId);
        
        if (!quest || !quest.tasks || !quest.tasks[taskId]) {
            return null;
        }
        
        return {
            questTitle: quest.title,
            questDescription: quest.metadata?.description,
            taskDesc: quest.tasks[taskId].desc,
            taskType: quest.tasks[taskId].type,
            points: quest.tasks[taskId].points,
            xp: quest.tasks[taskId].xp
        };
    } catch (error) {
        console.error(`Error getting quest/task info for ${questId}.${taskId}:`, error);
        return null;
    }
} 