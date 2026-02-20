import { exec, spawn } from 'child_process';

export default class LLM {
  async validateAnswer(answer,real_answer,quest,task) {
    return new Promise((resolve, reject) => {
      var command = `python3 ./src/checkAnswer.py "${answer}" "${real_answer}" "${quest}" "${task}" `;
      console.log(`${command}`);
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(error);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        console.log(`${stdout.trim().toLowerCase()}`);
        resolve(`${stdout.trim().toLowerCase()}`);
      });
    });
  }

  async validateTextAnswer(validationPrompt, enableDetailedFeedback = false, temperature = 0.1) {
    return new Promise((resolve, reject) => {
      // Use JSON.stringify to properly escape all special characters (quotes, backticks, $, etc.)
      // This ensures the prompt is safely passed without shell interpretation
      const escapedPrompt = JSON.stringify(validationPrompt);
      const enableFlag = enableDetailedFeedback ? 'true' : 'false';
      const tempArg = typeof temperature === 'number' ? String(temperature) : '0.1';
      
      // Use spawn with argument array to avoid shell interpretation of backticks, $, etc.
      const args = [escapedPrompt, enableFlag, tempArg];
      console.log(`Executing LLM validation: python3 ./src/validateTextAnswer.py [args: ${args.length}]...`);
      
      const pythonProcess = spawn('python3', ['./src/validateTextAnswer.py', ...args], {
        env: process.env,
        cwd: process.cwd()
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('error', (error) => {
          console.error(`Error in validateTextAnswer: ${error}`);
          reject(error);
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        const result = stdout.trim();
        console.log(`LLM validation result: ${result}`);
        resolve(result);
      });
    });
  }

  async validateImageAnswer(validationPrompt, imageUrl, enableDetailedFeedback = false, temperature = 0.1, githubToken = null) {
    return new Promise((resolve, reject) => {
      // Use JSON.stringify to properly escape all special characters (quotes, backticks, $, etc.)
      const escapedPrompt = JSON.stringify(validationPrompt);
      const escapedImageUrl = JSON.stringify(imageUrl);
      const enableFlag = enableDetailedFeedback ? 'true' : 'false';
      const tempArg = typeof temperature === 'number' ? String(temperature) : '0.1';
      const tokenArg = githubToken ? JSON.stringify(githubToken) : 'null';
      
      // Use spawn with argument array to avoid shell interpretation of backticks, $, etc.
      const args = [escapedPrompt, escapedImageUrl, enableFlag, tempArg, tokenArg];
      console.log(`Executing LLM image validation: python3 ./src/validateImageAnswer.py [args: ${args.length}]...`);
      
      const pythonProcess = spawn('python3', ['./src/validateImageAnswer.py', ...args], {
        env: process.env,
        cwd: process.cwd()
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('error', (error) => {
          console.error(`Error in validateImageAnswer: ${error}`);
          reject(error);
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        const result = stdout.trim();
        console.log(`LLM image validation result: ${result}`);
        resolve(result);
      });
    });
  }

  async quizAnswer(answer,format) {
    return new Promise((resolve, reject) => {
      console.log(answer);
      var command = `python3 ./src/quizAnswer.py "${answer}" "${format}"`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(error);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        resolve(`${stdout.trim()}`);
      });
    });
  }

  async createNewHint(quest,task) {
    return new Promise((resolve, reject) => {
      var command = `python3 ./src/newHint.py "${quest}" "${task}"`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(error);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        resolve(`${stdout.trim()}`);
      });
    });
  }

  async rewordHint(hint) {
    return new Promise((resolve, reject) => {
      var command = `python3 ./src/rewordHint.py "${hint}"`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(error);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        resolve(`${stdout.trim()}`);
      });
    });
  }

  async generateCode(prompt, temperature = 0.3) {
    return new Promise((resolve, reject) => {
      // Use JSON.stringify to properly escape all special characters
      const escapedPrompt = JSON.stringify(prompt);
      const tempArg = typeof temperature === 'number' ? String(temperature) : '0.3';
      
      // Use spawn with argument array to avoid shell interpretation
      const args = [escapedPrompt, tempArg];
      console.log(`Executing LLM code generation: python3 ./src/generateCode.py [args: ${args.length}]...`);
      
      const pythonProcess = spawn('python3', ['./src/generateCode.py', ...args], {
        env: process.env,
        cwd: process.cwd()
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`Error in generateCode: ${error}`);
        reject(error);
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        const result = stdout.trim();
        console.log(`LLM code generation result length: ${result.length} chars`);
        resolve(result);
      });
    });
  }

}

