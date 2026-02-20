import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import QuestModel from "../models/QuestModel.js";
import TaskModel from "../models/TaskModel.js";
import HintModel from "../models/HintModel.js";

dotenv.config();

const { URI, DB_NAME } = process.env;

/**
 * Upload hint configuration to database
 * This function reads from quest-sequence.json
 * @param {Object} db - Database connection
 * @returns {Promise<void>}
 */
export async function uploadHintConfig(db) {
  try {
    console.log("Reading hints from quest-sequence.json...");
    
    // Get all quests and tasks from quest-sequence.json
    const questSequencePath = "./src/config/quest-sequence.json";
    const questSequence = JSON.parse(fs.readFileSync(questSequencePath, "utf-8"));
    
    let totalHints = 0;
    
    // Process each quest
    for (const quest of questSequence.questSequence) {
      const questId = quest.questId;
      
      // Process each task in the quest
      for (const [taskId, taskData] of Object.entries(quest.tasks)) {
        if (taskData.detailedHints && Array.isArray(taskData.detailedHints)) {
          console.log(`Processing hints for ${questId}.${taskId}...`);
          
          // Insert each hint into the database
          for (const hint of taskData.detailedHints) {
            await db.insertHintResponse({
              questId: questId,
              taskId: taskId,
              sequence: hint.sequence,
              content: hint.content,
              penalty: hint.penalty || 5,
              image: hint.image || null,
              video: hint.video || null
            });
            totalHints++;
          }
        }
      }
    }
    
    console.log(`Successfully uploaded ${totalHints} hints from quest-sequence.json`);
  } catch (error) {
    console.error("Error uploading hint config:", error);
    throw error;
  }
}

// Legacy function for backward compatibility
async function uploadHints() {
  try {
    await mongoose.connect(URI, {
      dbName: DB_NAME,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to the database");

    // Use the new function
    await uploadHintConfig({
      insertHintResponse: async (hintData) => {
        const quest = await QuestModel.findOne({ questKey: hintData.questId });
        const task = await TaskModel.findOne({ taskKey: hintData.taskId });
        
        if (!quest || !task) {
          console.log(`Quest ${hintData.questId} or task ${hintData.taskId} not found.`);
          return;
        }

            const hint = new HintModel({
              quest: quest._id,
              task: task._id,
          temporaryID: `${hintData.questId}${hintData.taskId}`,
              sequence: hintData.sequence,
              penalty: hintData.penalty || 0,
              content: hintData.content,
              image: hintData.image,
              video: hintData.video
            });

            await hint.save();
        console.log(`Saved hint ${hintData.sequence} for task ${hintData.taskId} in quest ${hintData.questId}`);
          }
    });

    console.log("All hints uploaded successfully.");
  } catch (error) {
    console.error("Failed to upload hints:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from the database");
  }
}

uploadHints();
