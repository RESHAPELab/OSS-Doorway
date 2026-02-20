import { MongoClient } from 'mongodb';

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'oss-bot';

// Helper function to calculate overall completion percentage across all quests
function calculateOverallCompletion(user_data, questConfig) {
  if (!user_data) {
    return 0;
  }
  
  try {
    let totalTasks = 0;
    let completedTasks = 0;
    
    // Count tasks from completed quests
    if (user_data.completed && typeof user_data.completed === 'object') {
      Object.entries(user_data.completed).forEach(([questId, questData]) => {
        if (questData && typeof questData === 'object') {
          Object.entries(questData).forEach(([taskId, taskData]) => {
            if (taskData && typeof taskData === 'object' && taskData.completed) {
              totalTasks++;
              completedTasks++;
            } else if (taskData && typeof taskData === 'object') {
              totalTasks++;
            }
          });
        }
      });
    }
    
    // Count tasks from current quest if available
    if (user_data.current_quest && user_data.current_quest !== 'none') {
      const currentQuest = user_data.current_quest;
      const currentTask = user_data.current_task || 'T1';
      
      // If we have quest config, use it to get total tasks
      if (questConfig && questConfig[currentQuest]) {
        const questData = questConfig[currentQuest];
        if (questData && typeof questData === 'object') {
          Object.entries(questData).forEach(([taskId, taskData]) => {
            if (taskId.startsWith('T') && taskData && typeof taskData === 'object') {
              totalTasks++;
              // Check if this task is completed in user_data
              if (user_data.completed && 
                  user_data.completed[currentQuest] && 
                  user_data.completed[currentQuest][taskId] && 
                  user_data.completed[currentQuest][taskId].completed) {
                completedTasks++;
              }
            }
          });
        }
      } else {
        // Fallback: estimate based on common task patterns
        // This is a rough estimate for when quest config is not available
        const estimatedTasks = 12; // Most quests have around 12 tasks
        totalTasks += estimatedTasks;
        
        // Count completed tasks in current quest
        if (user_data.completed && user_data.completed[currentQuest]) {
          const currentQuestTasks = user_data.completed[currentQuest];
          if (typeof currentQuestTasks === 'object') {
            Object.values(currentQuestTasks).forEach(taskData => {
              if (taskData && typeof taskData === 'object' && taskData.completed) {
                completedTasks++;
              }
            });
          }
        }
      }
    }
    
    // If no tasks found, return 0
    if (totalTasks === 0) {
      return 0;
    }
    
    return completedTasks / totalTasks;
  } catch (error) {
    console.error('Error calculating overall completion:', error);
    return 0;
  }
}

// Helper function to calculate class percentile rank
function calculateClassPercentile(userCompletion, classStudents) {
  if (!classStudents || classStudents.length === 0) {
    return { percentile: 50, display: 'Top 50%', color: '#2f80ed' };
  }
  
  // Count students with lower completion
  const studentsBelow = classStudents.filter(s => {
    const completion = (s.completion || 0) * 100; // Convert to percentage
    return completion < userCompletion;
  }).length;
  
  const percentile = Math.round((studentsBelow / classStudents.length) * 100);
  
  // Determine display and color based on percentile
  let display, color;
  if (percentile >= 90) {
    display = `Top ${100 - percentile}%`;
    color = '#FFD700'; // Gold
  } else if (percentile >= 75) {
    display = `Top ${100 - percentile}%`;
    color = '#FFA500'; // Orange
  } else if (percentile >= 50) {
    display = `Top ${100 - percentile}%`;
    color = '#2f80ed'; // Blue
  } else {
    display = `Top ${100 - percentile}%`;
    color = '#00C853'; // Green
  }
  
  return { percentile, display, color };
}

async function listClassStudents(classId) {
  let client;
  
  try {
    console.log(`🔍 Listing students for class: ${classId}`);
    
    // Connect to MongoDB
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection('user_data');
    
    // Get base class ID (remove _purple_ suffix if present)
    const baseClassId = classId.split('_')[0];
    console.log(`📊 Using base class ID: ${baseClassId}`);
    
    // Get all users with the same customGroupId
    const users = await collection.find({}).toArray();
    const classUsers = users.filter(user => 
      user.user_data && 
      user.user_data.customGroupId && 
      user.user_data.customGroupId.startsWith(baseClassId)
    );
    
    console.log(`📊 Found ${classUsers.length} students in class`);
    
    if (classUsers.length === 0) {
      console.log('❌ No students found in this class');
      return;
    }
    
    // Calculate completion for each student
    const studentsWithCompletion = classUsers.map(user => {
      const completion = calculateOverallCompletion(user.user_data, null);
      return {
        username: user.user_data?.github || user.user_data?.username || 'unknown',
        completion: completion,
        points: user.user_data?.points || 0,
        xp: user.user_data?.xp || 0,
        currentQuest: user.user_data?.current_quest || 'none',
        customGroupId: user.user_data?.customGroupId
      };
    });
    
    // Sort by completion (highest first)
    studentsWithCompletion.sort((a, b) => b.completion - a.completion);
    
    // Calculate class rank for each student
    const studentsWithRank = studentsWithCompletion.map(student => {
      const classRank = calculateClassPercentile(student.completion * 100, studentsWithCompletion);
      return {
        ...student,
        classRank: classRank.display,
        percentile: classRank.percentile
      };
    });
    
    // Display results
    console.log('\n📊 CLASS STUDENT RANKINGS');
    console.log('='.repeat(80));
    console.log(`${'Rank'.padEnd(6)} ${'Username'.padEnd(25)} ${'Progress'.padEnd(10)} ${'Points'.padEnd(8)} ${'Class Rank'.padEnd(12)} ${'Current Quest'}`);
    console.log('-'.repeat(80));
    
    studentsWithRank.forEach((student, index) => {
      const rank = index + 1;
      const username = student.username.padEnd(25);
      const progress = `${(student.completion * 100).toFixed(1)}%`.padEnd(10);
      const points = `${student.points}`.padEnd(8);
      const classRank = student.classRank.padEnd(12);
      const currentQuest = student.currentQuest;
      
      console.log(`${rank.toString().padEnd(6)} ${username} ${progress} ${points} ${classRank} ${currentQuest}`);
    });
    
    // Summary statistics
    const avgCompletion = studentsWithRank.reduce((sum, s) => sum + s.completion, 0) / studentsWithRank.length;
    const totalPoints = studentsWithRank.reduce((sum, s) => sum + s.points, 0);
    const avgPoints = totalPoints / studentsWithRank.length;
    
    console.log('\n📈 CLASS SUMMARY');
    console.log('='.repeat(40));
    console.log(`Total Students: ${studentsWithRank.length}`);
    console.log(`Average Progress: ${(avgCompletion * 100).toFixed(1)}%`);
    console.log(`Average Points: ${avgPoints.toFixed(1)}`);
    console.log(`Total Points: ${totalPoints}`);
    
    // Top performers
    console.log('\n🏆 TOP PERFORMERS');
    console.log('='.repeat(40));
    studentsWithRank.slice(0, 5).forEach((student, index) => {
      console.log(`${index + 1}. ${student.username} - ${(student.completion * 100).toFixed(1)}% (${student.classRank})`);
    });
    
  } catch (error) {
    console.error('❌ Error listing class students:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Main execution
async function main() {
  const classId = process.argv[2];
  
  if (!classId) {
    console.log('❌ Please provide a class ID');
    console.log('Usage: node list-class-students.js <classId>');
    console.log('Example: node list-class-students.js 68a770b8140b9c0174c13ce7');
    process.exit(1);
  }
  
  await listClassStudents(classId);
}

main().catch(console.error);
