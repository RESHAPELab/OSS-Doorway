import fs from 'fs';

// Read the current file
let content = fs.readFileSync('./src/taskMapping.js', 'utf8');

// Add the missing handlers to specificHandlers object
content = content.replace(
  'handleQ1T5, handleQ1Quiz,',
  'handleQ1T5, handleQ1T6: handleQ1Quiz, handleQ1Quiz,'
);

content = content.replace(
  'handleQ2T4, handleQ2Quiz,',
  'handleQ2T4, handleQ2T5: handleQ2Quiz, handleQ2Quiz,'
);

content = content.replace(
  'handleQ3T3, handleQ3Quiz,',
  'handleQ3T3, handleQ3T4: handleQ3Quiz, handleQ3Quiz,'
);

// Add handleQ4T1 function before the specificHandlers object
const handleQ4T1Function = `
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
    response += \`\\n\\n[Click here to start](https://github.com/\${ossRepo})\`;
    return [response, false];
}

`;

content = content.replace(
  '// Store all specific handlers for fallback',
  handleQ4T1Function + '// Store all specific handlers for fallback'
);

// Add handleQ4T1 to the specificHandlers object
content = content.replace(
  'handleQ3T4: handleQ3Quiz, handleQ3Quiz,',
  'handleQ3T4: handleQ3Quiz, handleQ3Quiz, handleQ4T1,'
);

// Write the fixed content back
fs.writeFileSync('./src/taskMapping.js', content);

console.log('✅ Fixed taskMapping.js successfully!'); 