/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
import { questFunctions } from "./src/quest.js";
import { MongoDB } from "./src/database.js";
import fs from "fs";
const responseFilePath = "./src/config/response.json";
const responses = JSON.parse(
  fs.readFileSync(responseFilePath, "utf-8")
).responses;

const db = new MongoDB();
await db.connect();
export default (app) => {
  // Your code here
  app.log.info("Yay, the app was loaded!");

  // webhooks: https://github.com/octokit/webhooks.js/#webhook-events

  // issue command
  app.on("issues.opened", async (context) => {
    const user = context.payload.issue.user;
    if (user.type === "Bot" || user.login.includes('[bot]')) {
      return;
    }
    const issueComment = context.issue({
      body: responses.newIssue,
    });
    try {
      context.octokit.issues.createComment(issueComment);
    } catch (error) {
      console.error("Error creating a new issue: ", error);
    }

    return;
  });

  app.on("issue_comment.created", async (context) => {
    const user = context.payload.comment.user.login;
    const { owner, repo } = context.repo();
    if (context.payload.comment.user.type === "Bot") {
      return;
    }

    // check if / command
    const comment = context.payload.comment.body;
    if (comment.startsWith("/")) {
      const command = parseCommand(comment);
      var response = "";
      var status = false;

      // detect command
      if (command) {
        switch (command.action) {
          case "new_user":
            // create user
            status = await db.createUser(command.argument);
            if (status) {
              response = responses.newUserResponse;
              var user_document = await db.downloadUserData(command.argument);
              questFunctions.acceptQuest(context, user_document.user_data, "Q1");
              // update readme and data
              questFunctions.updateReadme(owner, repo, context, user_document.user_data); // TODO: same as below
              await db.updateData(user_document); // TODO: maybe doesnt need to be synchronus?
            } else {
              response = "Failed to create new user, user already exists";
            }
            break;
          case "reset":
            // wipe user from database
            await db.wipeUser(user);
            // reset readme
            await questFunctions.resetReadme(owner, repo, context);
            await questFunctions.closeIssues(context);
            break;
          default:
            // respond unknown command and avaialble commands
            response = responses.invalidCommand;
            break;
        }
        if (response !== "") {
          const issueComment = context.issue({ body: response });
          try {
            await context.octokit.issues.createComment(issueComment);
          } catch (error) {
            console.error("Error creating issue comment: ", error);
          }

        }
      }
    } else {
      try{
        var user_document = await db.downloadUserData(user);
        await questFunctions.validateTask(user_document.user_data, context, user);
        db.updateData(user_document);
      } catch{
        console.log("user " + user + " commented but does not yet exist in database. /new_user <user>");
      }
    }
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};

// match and break down / command
function parseCommand(comment) {
  const regex = /^(\/(new_user|reset))(\s.*)?$/;
  const match = comment.match(regex);
  if (match) {
    const action = match[2];
    var argument = match[3];
    if (argument) {
      argument = argument.trim();
    }
    return { action, argument };
  }
  const action = "";
  var argument = "";
  return { action, argument };
}
