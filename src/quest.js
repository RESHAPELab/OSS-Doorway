import fs from "fs";
const questFilePath = "./src/quest_config.json";
const responseFilePath = "./src/response.json";
const questResponse = JSON.parse(fs.readFileSync(responseFilePath, "utf-8"));
const quests = JSON.parse(fs.readFileSync(questFilePath, "utf8"));
const ossRepo = quests.oss_repo;
const mapRepoLink = quests.map_repo_link;

async function acceptQuest(context, db, user, quest) {
  const { owner, repo } = context.repo();
  try {
    // Read in available qeusts and validate requested quest
    if (quest in quests) {
      const user_data = await db.downloadUserData(user);
      if (!user_data.user_data.accepted) {
        user_data.user_data.accepted = {};
      }
      // if user has not accepted quest
      if (!Object.keys(user_data.user_data.accepted).length) {
        user_data.user_data.accepted[quest] = {};
        // add list of tasks to user in database
        for (const task in quests[quest]) {
          if (task !== "metadata") {
            user_data.user_data.accepted[quest][task] = { completed: false };
          }
          // track current progress
          user_data.user_data.current = {
            quest: quest,
            task: "T1", // depending on how indexing works in validate task, may need to change to 0
          };
          user_data.user_data.completion = 0;
        }
        await db.updateData(user_data);

        await createQuestEnvironment(quest, "T1", context);
        // update character stats
        await updateReadme(user, owner, repo, context, db);
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error accepting quest!: " + error);
    return false;
  }
}

async function removeQuest(db, user) {
  try {
    const user_data = await db.downloadUserData(user);
    if (user_data.user_data.accepted) {
      delete user_data.user_data.accepted;
      delete user_data.user_data.current;
      await db.updateData(user_data);
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error removing quest:", error);
    return false;
  }
}

async function completeQuest(db, user, quest, context) {
  try {
    const user_data = await db.downloadUserData(user);
    // user has the requested quest accepted
    if (user_data.user_data.accepted && user_data.user_data.accepted[quest]) {
      const tasks_completed = Object.values(
        user_data.user_data.accepted[quest]
      ).every((task) => task.completed); // all tasks completed

      // clear quest and task
      if (tasks_completed) {
        delete user_data.user_data.accepted[quest];
        if (!user_data.user_data.completed) {
          user_data.user_data.completed = [];
        }
        // add quest to users completed list
        user_data.user_data.completed.push(quest);
        // update user data in DB
        await db.updateData(user_data);

        // reset quest accepted and current
        await removeQuest(db, user);

        if (quest === "Q1") {
          await acceptQuest(context, db, user, "Q2");
        }
        if (quest === "Q2") {
          await acceptQuest(context, db, user, "Q3");
        }

        return true; // Quest successfully completed
      }
    }
  } catch (error) {
    console.error("Error completing quest:", error);
  }
  return false; // Quest not completed
}

async function completeTask(db, user, quest, task, context) {
  const { owner, repo } = context.repo();
  try {
    const quests = JSON.parse(fs.readFileSync(questFilePath, "utf8"));
    const user_data = await db.downloadUserData(user);

    const points = quests[quest][task].points;
    const xp = quests[quest][task].xp;

    if (
      user_data.user_data.accepted &&
      user_data.user_data.accepted[quest] &&
      user_data.user_data.accepted[quest][task]
    ) {
      user_data.user_data.accepted[quest][task].completed = true;
      user_data.user_data.points += points;
      user_data.user_data.xp += xp;

      const tasks = Object.keys(quests[quest]).filter((t) => t !== "metadata");
      const taskIndex = tasks.indexOf(task);

      user_data.user_data.completion = (taskIndex + 1) / tasks.length;
      user_data.user_data.completion =
        Math.round(user_data.user_data.completion * 100) / 100; // two decimal places

      if (taskIndex !== -1 && taskIndex < tasks.length - 1) {
        const nextTask = tasks[taskIndex + 1];
        user_data.user_data.current.task = nextTask;
        await db.updateData(user_data);
      } else {
        user_data.user_data.current.task = null;
        await db.updateData(user_data);
        await completeQuest(db, user, quest, context);
      }

      await context.octokit.issues.update({
        owner: owner,
        repo: repo,
        issue_number: context.issue().issue_number,
        state: "closed",
      });

      if (user_data.user_data.current) {
        await createQuestEnvironment(
          quest,
          user_data.user_data.current.task,
          context
        );
      }

      await updateReadme(user, owner, repo, context, db);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error completing task:", error);
    return false;
  }
}

async function createQuestEnvironment(quest, task, context) {
  var issueComment = "";
  const { owner, repo } = context.repo();
  var response = questResponse;
  var title = quests;
  var flag = false; // check for if task is selected
  // most will be creating an issue with multiple choice
  if (quest === "Q1") {
    response = response.Quest1;
    title = title.Q1;
    // Find issue tracker
    if (task === "T1") {
      response = response.Task1.acceptQ1T1;
      title = title.T1;
      flag = true;
    }
    // find pull request menu
    else if (task === "T2") {
      response = response.Task2.acceptQ1T2;
      title = title.T2;
      flag = true;
    }
    // find the fork button
    else if (task === "T3") {
      response = response.Task3.acceptQ1T3;
      title = title.T3;
      flag = true;
    }
    // find the readme file
    else if (task === "T4") {
      response = response.Task4.acceptQ1T4;
      title = title.T4;
      flag = true;
    }
    // find the contributors
    else if (task === "T5") {
      response = response.Task5.acceptQ1T5;
      title = title.T5;
      flag = true;
    }
  }
  // quest 2 generate environment where needed
  else if (quest === "Q2") {
    response = response.Quest2;
    title = title.Q2;
    // choose issue that you would like to work with
    if (task === "T1") {
      // generate issues, with tags
      response = response.Task1.acceptQ2T1;
      title = title.T1;
      flag = true;
    } else if (task === "T2") {
      // assign user to work on issue
      response = response.Task2.acceptQ2T2;
      title = title.T2;
      flag = true;
    } else if (task === "T3") {
      // post a commnet in the issue introducing yourself
      response = response.Task3.acceptQ2T3;
      title = title.T3;
      flag = true;
    } else if (task === "T4") {
      // mention a contributor
      response = response.Task4.acceptQ2T4;
      title = title.T4;
      flag = true;
    }
  }
  // quest 3
  else if (quest === "Q3") {
    response = response.Quest3;
    title = title.Q3;
    // solve issue (upload a file)
    if (task === "T1") {
      response = response.Task1.acceptQ3T1;
      title = title.T1;
      flag = true;
    }
    // submit pull request
    else if (task === "T2") {
      response = response.Task2.acceptQ3T2;
      title = title.T2;
      flag = true;
    }
    // post in the issue askingfor someone to review
    else if (task === "T3") {
      response = response.Task3.acceptQ3T3;
      title = title.T3;
      flag = true;
    }
    // close issue
    else if (task === "T4") {
      response = response.Task4.acceptQ3T4;
      title = title.T4;
      flag = true;
    }
  }
  response += `\n\n[Click here to start](https://github.com/${ossRepo})`;

  issueComment = context.issue({
    body: response,
  });
  if (flag) {
    try {
      // new issue for new task
      await context.octokit.issues.create({
        owner: owner,
        repo: repo,
        title: `❗ ${quest} ${task}: ` + title.desc,
        body: response,
      });
    } catch (error) {
      console.error("Error creating new issue: ", error);
    }
  }
}

async function validateTask(db, context, user) {
  try {
    var user_data = await db.downloadUserData(user);
    const selectedIssue = user_data.user_data.selectedIssue;
    // TODO: add exception handling
    const task = user_data.user_data.current.task;
    const quest = user_data.user_data.current.quest;
    var issueComment = context.payload.comment.body;
    var response = questResponse;
    const { owner, repo } = context.repo();

    if (quest === "Q1") {
      response = response.Quest1;
      if (task === "T1") {
        response = response.Task1;
        // Check issue tracker count
        const issueCount = await getIssueCount(ossRepo);
        if (issueCount !== null && context.payload.comment.body == issueCount) {
          response = response.successQ1T1;
          await completeTask(db, user, "Q1", "T1", context);
        } else {
          response = response.errorQ1T1;
        }
      } else if (task === "T2") {
        response = response.Task2;
        // Check pull request count
        const PRCount = await getPRCount(ossRepo);
        if (PRCount !== null && context.payload.comment.body == PRCount) {
          response = response.successQ1T2;
          await completeTask(db, user, "Q1", "T2", context);
        } else {
          response = response.errorQ1T2;
        }
      } else if (task === "T3") {
        response = response.Task3;
        // On fork or multiple choice
        const correctAnswer = "c"; // TODO: parameterize ??
        if (issueComment.toLowerCase().includes(correctAnswer)) {
          response = response.successQ1T3;
          await completeTask(db, user, "Q1", "T3", context);
        } else {
          response = response.errorQ1T3;
        }
      } else if (task === "T4") {
        response = response.Task4;
        // Check issue body for a hint about readme
        const hint = "d";
        if (issueComment.toLowerCase().includes(hint)) {
          response = response.successQ1T4;
          await completeTask(db, user, "Q1", "T4", context);
        } else {
          response = response.errorQ1T4;
        }
      } else if (task === "T5") {
        response = response.Task5;
        // Check for valid contributor name
        // const correctAnswer = await getFirstContributor(ossRepo, context);
        const correctAnswer = await countContributors(ossRepo, context);
        if (issueComment.toLowerCase() == correctAnswer) {
          await completeTask(db, user, "Q1", "T5", context);
          response = response.successQ1T5;
        } else {
          response = response.errorQ1T5;
        }
      }
    }
    // quest 2
    else if (quest === "Q2") {
      response = response.Quest2;
      // choose issue that you would like to work with
      if (task === "T1") {
        // check open issues
        response = response.Task1;
        const openIssueNums = await openIssues(ossRepo, context);
        if (openIssueNums.includes(Number(issueComment)) && 
            await isFirstAssignee(ossRepo, user, Number(issueComment))) {
          response = response.successQ2T1;
          // add selected issue to database
          user_data.user_data.selectedIssue = Number(issueComment);
          await db.updateData(user_data);
          // complete task
          await completeTask(db, user, "Q2", "T1", context);
        } else {
          response = response.errorQ2T1;
        }
      } else if (task === "T2") {
        response = response.Task2;
        // check assignee in selected issue
        if (await checkAssignee(ossRepo, selectedIssue, user, context)) {
          await completeTask(db, user, "Q2", "T2", context);
          response = response.successQ2T2;
        } else {
          response = response.errorQ2T2;
        }
      } else if (task === "T3") {
        response = response.Task3;
        // check if user commented
        if (
          await userCommentedInIssue(ossRepo, selectedIssue, user, context)
        ) {
          await completeTask(db, user, "Q2", "T3", context);
          response = response.successQ2T3;
        } else {
          response = response.errorQ2T3;
        }
      } else if (task === "T4") {
        response = response.Task4;
        if (
          await isContributorMentionedInIssue(ossRepo, selectedIssue, context)
        ) {
          await completeTask(db, user, "Q2", "T4", context);
          response = response.successQ2T4;
        } else {
          response = response.errorQ2T4;
        }
      }
    }
    // quest 3
    else if (quest === "Q3") {
      response = response.Quest3;
      if (task === "T1") {
        response = response.Task1;
        const correctAnswer = "a";
        //if (await userCommited(ossRepo, user, context)) {
        if (issueComment.toLowerCase().includes(correctAnswer)) {
          response = response.successQ3T1; // with current quest design, "non code contribution" tagged issue should be there, otherwise will need to create it programatically
          await completeTask(db, user, "Q3", "T1", context);
        } else {
          response = response.errorQ3T1;
        }
      } else if (task === "T2") {
        response = response.Task2;
        if (await userPRAndComment(ossRepo, user, context)) {
          response = response.successQ3T2;
          await completeTask(db, user, "Q3", "T2", context);
        } else {
          response = response.errorQ3T2;
        }
      } else if (task === "T3") {
        response = response.Task3;
        // issue closed
        if (await issueClosed(ossRepo, selectedIssue, context)) {
          response = response.successQ3T3;

          await completeTask(db, user, "Q3", "T3", context);
        } else {
          response = response.errorQ3T3;
        }
      }
    }
    response += `\n\nReturn [Home](https://github.com/${owner}/${repo})`;

    issueComment = context.issue({
      body: response,
    });
    await context.octokit.issues.createComment(issueComment);
  } catch (error) {
    console.error("Error validating task: " + error);
  }
}

async function getIssueCount(repo) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`);
    if (response.ok) {
      const issues = await response.json();
      // Filter out pull requests
      const actualIssues = issues.filter(issue => !issue.pull_request);
      return actualIssues.length;
    } else {
      console.error("Error:", response.status);
      return null;
    }
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

async function isFirstAssignee(repo, user, selectedIssue) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${selectedIssue}`);
    if (!response.ok) {
      throw new Error(`Issue ${selectedIssue} not found in repository ${repo}`);
    }
    const issueSelected = await response.json();
    const assignees = issueSelected.assignees.map(assignee => assignee.login);
    
    if (assignees.length === 0) {
      return true; // no assignees
    } else if (assignees.length === 1 && assignees.includes(user)) {
      return true; // user first assignee
    } else {
      return false; // other assignee or issue doesnt exist
    }
  } catch (error) {
    console.error("Error checking assignees: " + error);
    return false;
  }
}


async function getPRCount(repo) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/pulls`);
    const data = await response.json();

    // Check if the response is an array (list of pull requests)
    if (Array.isArray(data)) {
      // The length of the array gives the number of pull requests
      return data.length;
    } else {
      throw new Error("Unexpected response format");
    }
  } catch (error) {
    console.error("Error fetching pull requests:", error);
    throw error;
  }
}

async function getFirstContributor(repo, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    const response = await context.octokit.request(
      `GET /repos/${repo}/contributors`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );
    const contributors = response.data;
    if (contributors.length > 0) {
      return contributors[0].login;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error getting first contributor: ", error);
    return null;
  }
}

async function isContributorMentionedInIssue(repo, issueNumber, context) {
  try {
    // Get the installation ID from the context
    const installationID = context.payload.installation.id;

    // Authenticate as the installation to get the access token
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    // Fetch the list of contributors for the repository
    const contributorsResponse = await context.octokit.request(
      `GET /repos/${repo}/contributors`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );

    // Extract the contributors data
    const contributors = contributorsResponse.data;
    const contributorLogins = contributors.map(
      (contributor) => contributor.login
    );

    // Fetch the specified issue
    const issueResponse = await context.octokit.request(
      `GET /repos/${repo}/issues/${issueNumber}`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );

    // Extract the issue data
    const issue = issueResponse.data;
    const issueBody = issue.body;

    // Fetch the comments for the issue
    const commentsResponse = await context.octokit.request(
      `GET /repos/${repo}/issues/${issueNumber}/comments`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );

    // Extract the comments data
    const comments = commentsResponse.data;
    const commentsBody = comments.map((comment) => comment.body).join(" ");

    // Combine the i ssue body and comments to check for mentions
    const combinedText = issueBody + " " + commentsBody;

    // Check if any contributor is mentioned in the combined text
    for (const contributorLogin of contributorLogins) {
      if (combinedText.includes(`@${contributorLogin}`)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    // Log any errors and return false to indicate failure
    console.error(
      "Error checking if any contributor is mentioned in the issue: ",
      error
    );
    return false;
  }
}

async function userCommited(repo, user, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    const response = await context.octokit.request(
      `GET /repos/${repo}/commits`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );
    const commits = response.data;
    const userCommited = commits.find(
      (commit) => commit.author && commit.author.login == user
    );
    if (userCommited) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error finding user commits: ", error);
    return false;
  }
}

async function countContributors(repo, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });
    const response = await context.octokit.request(
      `GET /repos/${repo}/contributors`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );

    // Extract the contributors data from the response
    const contributors = response.data;

    // Return the number of contributors
    return contributors.length;
  } catch (error) {
    // Log any errors and return 0 to indicate failure
    console.error("Error counting contributors: ", error);
    return 0;
  }
}

async function userPRAndComment(repo, user, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    // Check if the user submitted any pull requests
    const pullRequestsResponse = await context.octokit.request(
      `GET /repos/${repo}/pulls`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );
    const pullRequests = pullRequestsResponse.data;
    const userPullRequest = pullRequests.find(
      (pr) => pr.user && pr.user.login === user
    );

    if (!userPullRequest) {
      return false;
    }

    // Check if the user commented on their pull request
    const pullNumber = userPullRequest.number;
    const commentsResponse = await context.octokit.request(
      `GET /repos/${repo}/issues/${pullNumber}/comments`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );
    const comments = commentsResponse.data;
    const userCommented = comments.find(
      (comment) => comment.user && comment.user.login === user
    );

    if (userCommented) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error finding user pull requests or comments: ", error);
    return false;
  }
}

async function userCommentedInIssue(repo, issueNum, user, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    const response = await context.octokit.request(
      `GET /repos/${repo}/issues/${issueNum}/comments`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );
    const comments = response.data;

    const userInComments = comments.some(
      (comment) => comment.user.login === user
    ); // find any instance of user commenting
    return userInComments;
  } catch (error) {
    console.error("Error finding user comment in issues: ", error);
    return false;
  }
}

async function openIssues(repo, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open`,
      {
        headers: {
          Authorization: `token ${accessToken.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const issues = await response.json();
    const openIssueNumbers = issues.map((issue) => issue.number);
    return openIssueNumbers;
  } catch (error) {
    console.error(`Error getting open issues: ${error}`);
    return null;
  }
}

async function issueClosed(repo, issueNum, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNum}`,
      {
        headers: {
          Authorization: `token ${accessToken.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const issue = await response.json();
    const isClosed = issue.state === "closed";
    return isClosed;
  } catch (error) {
    console.error("Error checking if issue closed: ", error);
    return false;
  }
}

async function checkAssignee(repo, issueNum, user, context) {
  try {
    const installationID = context.payload.installation.id;
    const accessToken = await context.octokit.auth({
      type: "installation",
      installationID,
    });

    const response = await context.octokit.request(
      `GET /repos/${repo}/issues/${issueNum}`,
      {
        headers: {
          authorization: `token ${accessToken.token}`,
        },
      }
    );

    const issue = response.data;
    // assignees
    const assignees = issue.assignees.map((assignee) => assignee.login);

    // is user in one of the assignees
    if (assignees.includes(user)) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error checking assignees:" + error);
  }
}

async function generateSVG(user, owner, repo, context, db) {
  try {
    // Fetch user data
    const userDocument = await db.downloadUserData(user);
    const percentage = userDocument.user_data.completion * 100;
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - percentage / 100);

    // Define SVG content
    const svgContent = `
    <svg
        width="450"
        height="195"
        viewBox="0 0 450 195"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby="descId"
    >
        <title id="titleId">User's Quest Stats, Level: 2</title>
        <desc id="descId">Total Quests Completed: 3, Power Ups Used: 2, Community Rating: 5</desc>
        <style>
            .header {
                font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif;
                fill: #21262d;
                animation: fadeInAnimation 0.8s ease-in-out forwards;
            }
            @supports(-moz-appearance: auto) {
                /* Selector detects Firefox */
                .header { font-size: 15.5px; }
            }
            
            .stat {
                font: 600 14px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; 
                fill: white;
            }
            @supports(-moz-appearance: auto) {
                /* Selector detects Firefox */
                .stat { font-size: 12px; }
            }
            .stagger {
                opacity: 0;
                animation: fadeInAnimation 0.3s ease-in-out forwards;
            }
            .rank-text {
                font: 800 24px 'Segoe UI', Ubuntu, Sans-Serif; 
                fill: white;
                animation: scaleInAnimation 0.3s ease-in-out forwards;
            }
            .rank-percentile-header {
                font-size: 14px;
            }
            .rank-percentile-text {
                font-size: 16px;
            }
            
            .not_bold { font-weight: 400 }
            .bold { font-weight: 700 }
            .icon {
                fill: #4c71f2;
                display: none;
            }
    
            .rank-circle-rim {
                stroke: #2f80ed;
                fill: none;
                stroke-width: 6;
                opacity: 0.2;
            }
            .rank-circle {
                stroke: #2f80ed;
                stroke-dasharray: ${circumference};
                stroke-dashoffset: ${offset};
                fill: none;
                stroke-width: 6;
                stroke-linecap: round;
                opacity: 0.8;
                transform-origin: -10px 8px;
                transform: rotate(-90deg);
                animation: rankAnimation 1s forwards ease-in-out;
            }
            
            @keyframes rankAnimation {
                from {
                    stroke-dashoffset: ${circumference};
                }
                to {
                    stroke-dashoffset: ${offset};
                }
            }
        
            /* Animations */
            @keyframes scaleInAnimation {
                from {
                    transform: translate(-5px, 5px) scale(0);
                }
                to {
                    transform: translate(-5px, 5px) scale(1);
                } 
            }
            @keyframes fadeInAnimation {
                from {
                    opacity: 0;
                }
                to {
                    opacity: 1;
                }
            }
        </style>
    
        <rect
            data-testid="card-bg"
            x="0.5"
            y="0.5"
            rx="4.5"
            height="99%"
            stroke="#e4e2e2"
            width="449"
            fill="#21262d"
            stroke-opacity="1"
        />
    
        <g data-testid="card-title" transform="translate(25, 35)">
            <g transform="translate(0, 0)">
                <text x="0" y="0" class="header" data-testid="header">User's Quest Stats</text>
            </g>
        </g>
    
        <g data-testid="main-card-body" transform="translate(0, 55)">
            <g data-testid="rank-circle" transform="translate(365, 30)">
                <circle class="rank-circle-rim" cx="-10" cy="8" r="40" />
                <circle class="rank-circle" cx="-10" cy="8" r="40" />
                <g class="rank-text">
                    <text x="-5" y="3" alignment-baseline="central" dominant-baseline="central" text-anchor="middle" data-testid="level-rank-icon">${percentage}%</text>
                    <text x="-2" y="-55" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle" class="stat bold" fill="#2f80ed">User's Quest Progress 🕹️</text>
                </g>
            </g>
    
            <svg x="0" y="0">
                <g transform="translate(0, 0)">
                    <g class="stagger" style="animation-delay: 450ms" transform="translate(25, 0)">
                        <text class="stat bold" y="12.5">Quests Completed ❓:</text>
                        <text class="stat bold" x="199.01" y="12.5" data-testid="stars">${userDocument.user_data.completed && userDocument.user_data.completed !== undefined ? userDocument.user_data.completed : 0}</text>
                    </g>
                </g>
                <g transform="translate(0, 25)">
                    <g class="stagger" style="animation-delay: 600ms" transform="translate(25, 0)">
                        <text class="stat bold" y="12.5">Total Points✨:</text>
                        <text class="stat bold" x="199.01" y="12.5" data-testid="commits">${userDocument.user_data.points}</text>
                    </g>
                </g>
                <g transform="translate(0, 50)">
                    <g class="stagger" style="animation-delay: 750ms" transform="translate(25, 0)">
                        <text class="stat bold" y="12.5">User's Level 🌟:</text>
                        <text class="stat bold" x="199.01" y="12.5" data-testid="prs">${Math.floor(userDocument.user_data.xp / 100) + 1}</text>
                    </g>
                </g>
            </svg>
        </g>
    </svg>
    `;

    // Generate a unique filename based on the current timestamp
    const timestamp = Date.now();
    const newFilename = `userCards/draft-${timestamp}.svg`;

    // Write to the new file
    await context.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: newFilename,
      message: `Update ${newFilename}`,
      content: Buffer.from(svgContent).toString("base64"),
      committer: {
        name: "gitBot",
        email: "connor.nicolai.aiton@gmail.com",
      },
      author: {
        name: "caiton1",
        email: "connor.nicolai.aiton@gmail.com",
      },
    });

    return newFilename;
  } catch (error) {
    console.error("Error generating SVG:", error);
  }
}



async function closeIssues(context) {
  const issue = context.payload.issue;

  // Check if the comment contains the command to close all issues
  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  const currentIssueNumber = issue.number;

  // Fetch all issues in the repository
  const issues = await context.octokit.issues.listForRepo({
    owner,
    repo,
    state: "open", // Only fetch open issues since closed issues are already closed
  });

  // Iterate through the issues and close them except for the current issue
  for (const issue of issues.data) {
    if (issue.number !== currentIssueNumber) {
      try {
        // Close issue
        await context.octokit.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          state: "closed",
        });
      } catch (error) {
        console.error(`Failed to close issue #${issue.number}:`, error);
      }
    }
  }
}

async function resetReadme(owner, repo, context) {
  var content = `## 🛡️ OSSDoorway: A Gamified Learning Environment for OSS Contributions

OSSDoorway is a free, open-source platform designed to engage users in learning about the open-source software (OSS) contribution process through interactive quests. Users embark on educational quests that guide them through the various stages of OSS contributions, such as submitting pull requests, writing documentation, and solving issues. Each quest is designed to be both informative and engaging, incorporating game elements like progression bars, XP, and levels.

OSSDoorway quests and activities are designed to be accessible and inclusive, ensuring that users from diverse backgrounds and skill levels can benefit from the platform. Join OSSDoorway today and start your journey towards becoming a proficient OSS contributor!

---

### Setup
Requirnments:
- Node.js 18+
- npm 10+
- MongoDB

How to run:
1. Run NPM start and go to generated link
2. Follow instructions
3. in .env create two entries (subject to change later)
  - URI <-- uri to mongoDB
  - DB_NAME <-- name of mongoDB

#### Commands
In issues tab, you can interact with basic bot functions, create a new issue and it will list available commands.
`;
  try {
    const {
      data: { sha },
    } = await context.octokit.repos.getReadme({
      owner,
      repo,
      path: "README.md",
    });
    await context.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "README.md",
      message: "Reseting README.md",
      content: Buffer.from(content).toString("base64"),
      committer: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      author: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      sha: sha,
    });
  } catch (error) {
    console.error("Error reseting the README: " + error);
  }
}

async function updateReadme(user, owner, repo, context, db) {
  try {
    // generate new svg
    const newSVG = await generateSVG(user, owner, repo, context, db);
    // updated content, user card, quests and tasks, quest map
    var newContent = ` ## 🛡️ OSSDoorway: A Gamified Learning Environment for OSS Contributions

OSSDoorway is a free, open-source platform designed to engage users in learning about the open-source software (OSS) contribution process through interactive quests. Users embark on educational quests that guide them through the various stages of OSS contributions, such as submitting pull requests, writing documentation, and solving issues. Each quest is designed to be both informative and engaging, incorporating game elements like progression bars, XP, and levels.

OSSDoorway quests and activities are designed to be accessible and inclusive, ensuring that users from diverse backgrounds and skill levels can benefit from the platform. Join OSSDoorway today and start your journey towards becoming a proficient OSS contributor!

---

`;

    newContent += `
  User Stats:<br>
  ![User Draft Stats](/${newSVG}?)
  `;

    newContent += await displayQuests(user, db, context);

    // Get the README file
    const readmeResponse = await context.octokit.repos.getReadme({
      owner,
      repo,
      path: "README.md",
    });

    const {
      data: { sha },
    } = readmeResponse;

    // Verify the sha value
    if (!sha) {
      throw new Error("README sha is undefined or null");
    }

    // Update the README file
    await context.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "README.md",
      message: "Update README.md",
      content: Buffer.from(newContent).toString("base64"),
      committer: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      author: {
        name: "QuestBuddy",
        email: "naugitbot@gmail.com",
      },
      sha: sha,
    });
  } catch (error) {
    console.error("Error updating the README: " + error);
  }
}

// Function to get the map link based on the current quest and task
function getMapLink(userData, quest, task, completed) {
  if (!userData || !userData.user_data) {
    return `${mapRepoLink}/Q1.png`; // Return default map link if userData or accepted quests are not available
  }

  // if all quests completed
  if (completed.length === 3){ // TODO: remove hard code, improve mess of a function
    return `${mapRepoLink}/F.png`;
  }
  if (quest === "") {
    // Check if the current quest is completed and find the next available quest
    if (completed !== "") {
      const accepted_quests = Object.keys(userData.user_data.accepted);
      const currentQuestIndex = accepted_quests.indexOf(completed);
      const nextQuest =
        currentQuestIndex !== -1 && currentQuestIndex + 1 < accepted_quests.length
          ? accepted_quests[currentQuestIndex + 1]
          : null;

      // Return the map link for the next available quest if exists
      if (nextQuest) {
        return `${mapRepoLink}/${nextQuest}.png`;
      }
    }
    return `${mapRepoLink}/Q1.png`; // Fall through if no next quest is available or no quest is currently set
  }

  const acceptedTasks = userData.user_data.accepted[quest];
  if (!acceptedTasks || Object.keys(acceptedTasks).length === 0) {
    return `${mapRepoLink}/${quest}.png`; // Quest image when no task is started
  }

  const completedTasks = Object.values(acceptedTasks).filter(
    (t) => t.completed
  ).length;
  const totalTasks = Object.keys(acceptedTasks).length;

  if (completedTasks === 0) {
    return `${mapRepoLink}/${quest}.png`; // Quest initial map
  } else if (completedTasks === totalTasks) {
    return `${mapRepoLink}/${quest}F.png`; // Quest completed map
  } else {
    return `${mapRepoLink}/${quest}${task}.png`; // Specific task image
  }
}
async function displayQuests(user, db, context) {
  // Get user data
  const repo = context.issue();
  const userData = await db.downloadUserData(user);
  var task = "";
  var quest = "";
  var completed = "";

  // TODO: add exception handling
  if (userData.user_data.current !== undefined) {
    task = userData.user_data.current.task;
    quest = userData.user_data.current.quest;
  }

  if (userData.user_data.completed !== undefined) {
    completed = userData.user_data.completed;
  }
  // Determine the map link
  const mapLink = getMapLink(userData, quest, task, completed);

  var response = ``;
  // TODO: get from json, not hardcode
  const quests = {
    Q1: {
      title: "Quest 1 - Exploring the Github World",
      tasks: [
        "Explore the issue tracker",
        "Explore the pull-request menu",
        "Explore the fork button",
        "Explore the readme file",
        "Explore the contributors",
      ],
    },
    Q2: {
      title: "Quest 2 - Introducing yourself to the community",
      tasks: [
        "Choose an issue that you would like to work with",
        "Assign your user to work on the issue",
        "Post a comment in the issue introducing yourself",
        "Mention a contributor that has most recently been active in the project to help you solve the issue",
      ],
    },
    Q3: {
      title: "Quest 3 - Making your first contribution",
      tasks: [
        "Solve the issue (upload a file)",
        "Submit a pull request",
        "Close the issue",
      ],
    },
  };
  
  if (completed !== "" && completed.includes("Q1")) {
    response += "\n  - ~Quest 1 - Exploring the GitHub World~\n";
  }
  if (completed !== "" && completed.includes("Q2")) {
    response += "\n  - ~Quest 2 - Introducing yourself to the community~\n";
  }
  if (completed !== "" && completed.includes("Q3")) {
    response += "\n  - ~Quest 3 - Making your first contribution~\n";
  }
  response += "\n";
  if (quest in quests) {
    const currentQuest = quests[quest];
    response += `Quest:\n  - ${currentQuest.title}\n`;
    currentQuest.tasks.forEach((desc, index) => {
      const taskNum = `T${index + 1}`;
      const isCompleted =
        userData.user_data.accepted[quest] &&
        userData.user_data.accepted[quest][taskNum] &&
        userData.user_data.accepted[quest][taskNum].completed;
      if (isCompleted) {
        response += `    - ~Task ${index + 1} - ${desc}~ [COMPLETED]\n`;
      } else if (task === taskNum) {
        response += `    - Task ${index + 1} - ${desc} [[Click here to start](https://github.com/${repo.owner
          }/${repo.repo}/issues/${repo.issue_number + 1})]\n`;
      } else {
        response += `    - Task ${index + 1} - ${desc}\n`;
      }
    });
  }
  response += `\nQuests Map:\n![Quest Map](${mapLink})`;
  return response;
}

export const questFunctions = {
  acceptQuest,
  removeQuest,
  completeQuest,
  completeTask,
  displayQuests,
  createQuestEnvironment,
  validateTask,
  closeIssues,
  resetReadme,
  updateReadme,
  getIssueCount,
  getPRCount,
};
