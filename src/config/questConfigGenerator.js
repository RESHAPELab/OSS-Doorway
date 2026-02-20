import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ConfigService } from "../services/configService.js";

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generates quest configuration in the legacy quest_config.json format
 * from the enhanced quest-sequence.json file
 * @returns {Object} Quest configuration in legacy format
 */
export function generateQuestConfigFromSequence() {
  try {
    // Read the enhanced quest-sequence.json
    const questSequencePath = path.join(__dirname, "quest-sequence.json");
    const questSequence = JSON.parse(fs.readFileSync(questSequencePath, "utf8"));
    
    // Initialize the legacy format object
    const legacyConfig = {
      map_repo_link: questSequence.map_repo_link
    };
    
    // Convert each quest from sequence format to legacy format
    questSequence.questSequence.forEach(quest => {
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
  } catch (error) {
    console.error("Error generating quest config from sequence:", error);
    throw error;
  }
}

/**
 * Validates quest configuration for common issues
 * @param {Object} questConfig - Quest configuration to validate
 * @returns {Array} Array of validation warnings/errors
 */
export function validateQuestConfig(questConfig) {
  const warnings = [];
  
  // Check for ObjectId-like quest IDs
  const objectIdPattern = /^[0-9a-fA-F]{24}$/;
  
  for (const [questId, questData] of Object.entries(questConfig)) {
    if (questId === "map_repo_link") continue;
    
    // Check if quest ID looks like a MongoDB ObjectId
    if (objectIdPattern.test(questId)) {
      warnings.push(`⚠️  Quest ID "${questId}" appears to be a MongoDB ObjectId. Consider using a simple string ID like "Q0", "Q1", etc.`);
    }
    
    // Check for very long quest IDs
    if (questId.length > 20) {
      warnings.push(`⚠️  Quest ID "${questId}" is very long (${questId.length} characters). Consider using a shorter, more memorable ID.`);
    }
    
    // Check for special characters in quest IDs
    if (/[^a-zA-Z0-9_]/.test(questId)) {
      warnings.push(`⚠️  Quest ID "${questId}" contains special characters. Simple alphanumeric IDs work best.`);
    }
  }
  
  return warnings;
}

/**
 * Gets quest configuration - either from generated sequence or fallback to legacy file
 * @param {string} groupId - Optional group ID for custom sequences
 * @returns {Object} Quest configuration
 */
export function getQuestConfig(groupId = null) {
  try {
    // If groupId is provided, try to load group-specific config
    if (groupId) {
      const groupConfigPath = path.join(__dirname, "generated", `quest_config_${groupId}.json`);
      if (fs.existsSync(groupConfigPath)) {
        console.log(`Loading group-specific config: ${groupConfigPath}`);
        const config = JSON.parse(fs.readFileSync(groupConfigPath, "utf8"));
        
        // Validate the config and log warnings
        const warnings = validateQuestConfig(config);
        if (warnings.length > 0) {
          console.warn("Quest configuration validation warnings:");
          warnings.forEach(warning => console.warn(warning));
        }
        
        return config;
      } else {
        console.warn(`Group config not found: ${groupConfigPath}, falling back to default`);
      }
    }
    
    // Generate from quest-sequence.json (no fallback)
    const config = generateQuestConfigFromSequence();
    
    // Validate the config and log warnings
    const warnings = validateQuestConfig(config);
    if (warnings.length > 0) {
      console.warn("Quest configuration validation warnings:");
      warnings.forEach(warning => console.warn(warning));
    }
    
    return config;
  } catch (error) {
    console.error("Failed to generate from quest-sequence.json:", error);
    throw new Error("quest-sequence.json is required and could not be loaded");
  }
}

/**
 * Gets quest configuration for a specific group
 * @param {string} groupId - The group ID
 * @returns {Object} Quest configuration for the group
 */
export async function getGroupQuestConfig(groupId) {
  try {
    console.log(`🔍 [QUEST-CONFIG-LOAD] Loading config for group: ${groupId}`);
    
    // Use ConfigService which handles database first, then file fallback
    const config = await ConfigService.loadConfig(groupId);
    if (config) {
      console.log(`✅ [QUEST-CONFIG-LOAD] Successfully loaded config for: ${groupId}`);
      return config;
    }
    
    // If ConfigService returns null, throw error to trigger fallback in calling function
    throw new Error(`No config found for group: ${groupId}`);
    
  } catch (error) {
    console.error(`Error loading group config for ${groupId}:`, error);
    throw error;
  }
}

/**
 * Gets quest sequence data (for badge descriptions, etc.)
 * @param {string} groupId - Optional group ID for custom sequences
 * @returns {Object} Quest sequence data
 */
export function getQuestSequence(groupId = null) {
  try {
    // If groupId is provided, try to load group-specific sequence
    if (groupId) {
      const groupConfigPath = path.join(__dirname, "generated", `quest_config_${groupId}.json`);
      if (fs.existsSync(groupConfigPath)) {
        const groupConfig = JSON.parse(fs.readFileSync(groupConfigPath, "utf8"));
        return groupConfig;
      }
    }
    
    // Fallback to default quest-sequence.json
    const questSequencePath = path.join(__dirname, "quest-sequence.json");
    return JSON.parse(fs.readFileSync(questSequencePath, "utf8"));
  } catch (error) {
    console.error("Error reading quest sequence:", error);
    throw error;
  }
} 