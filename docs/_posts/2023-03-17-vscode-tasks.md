---
layout: post
title: VSCode tasks
date: 2023-03-16 12:00:00 +01:00
category: dev
author: Tomas Ekeli
permalink: 2023/03/vscode-tasks/
tags: [vscode, dev, devex]
summary: "Setting up tasks in vscode to get a smoother red-green-refactor cycle"
---

![multicoloured cogs on a blue background](/assets/img/2023-03-16-vscode-tasks.webp)

Tired of constantly switching between the terminal and your code editor while working on your .NET projects? I am. Today I’ll show you how to configure Visual Studio Code (VSCode) with .NET to run tests, watch for changes, and run ASP.NET Core projects.

We will set up your `tasks.json` file to create custom tasks for building, testing, and running your projects.

### Create a Build Task

First, we’ll create a [task](https://code.visualstudio.com/Docs/editor/tasks) to build our solution. To do this, add the following task configuration to your `tasks.json` file:

```json
{
	"label": "build",
	"command": "dotnet",
	"type": "process",
	"group": "build",
	"args": [
		"build",
		"${workspaceFolder}/YourSolution.sln",
		"/property:GenerateFullPaths=true",
		"/consoleloggerparameters:NoSummary"
	],
	"problemMatcher": "$msCompile"
}

```

This task will build your .NET solution (replace “YourSolution” with your solution’s name) and report any compilation issues to the problems panel in VSCode.

This task uses the built-in `$msCompile` problem-matcher. It is fine for normal builds, but for watches and tests we’ll have to dive a bit deeper, as we’ll get to..

### Configure Tasks for Running Tests

Now let’s set up tasks to run our tests. We’ll start by creating a task to run all tests in the solution:

```json
{
	"label": "test",
	"command": "dotnet",
	"type": "process",
	"group": "test",
	"presentation": {
		"reveal": "silent",
		"panel": "dedicated",
		"close": true,
		"group": "tests",
		"focus": false,
		"clear": true,
		"echo": false,
		"revealProblems": "onProblem",
		"showReuseMessage": false,
	},
	"args": [
		"test",
		"${workspaceFolder}/YourSolution.sln",
		"--nologo",
		"/property:GenerateFullPaths=true",
		"/consoleloggerparameters:NoSummary"
	],
	"problemMatcher": {
		"owner": "tests",
		"fileLocation": "absolute",
		"pattern": [
			{
				"regexp": "^\\s*at (?:[^.]+\\.)+([^()]+)\\(\\) in (.*):line (\\d+)$",
				"message": 1,
				"file": 2,
				"line": 3,
			}
		]
	}
}
```

This task runs all tests within your solution and displays the output in a dedicated panel. I’m using [XUnit](https://xunit.net/), so my problem-matcher is custom for how that logs test-failures.

The task runs `dotnet test` on the solution in the workspace -root, that should run all the tests if you’ve been good and added all your test-projects to the solution.

The `presentation` property is all about customizing how the task output appears in the integrated terminal. It lets you control when the terminal pops up, which panel to use, and how the output is displayed.

The `problemMatcher` property helps you catch problems (errors or warnings) in the output. It uses patterns to identify issues and then displays them in the “Problems” panel of VSCode. This makes it easier to spot and fix any issues that come up during testing. This is the part that causes red squigglies in your code!

In this example, the `problemMatcher` is tailored for XUnit test failures, but you can customize it for your preferred testing framework. This one looks for lines from stack-traces and picks out the file, line-number and just uses the last part of the caller (which should be the test-method) as the message. [Regexen are fun!](https://regex101.com/)

Next, we’ll create tasks to watch individual test projects for changes and re-run the affected tests automatically. Add the following task configuration for each test project (if you are like me you probably have a few):

```jsonc
{
	"label": "watch YourTestProject.Tests",
	"command": "dotnet",
	"type": "process",
	"group": "test",
	"presentation": {
		"reveal": "silent",
		"panel": "dedicated",
		"close": true,
		"group": "tests",
		"focus": false,
		"clear": true,
		"echo": false,
		"revealProblems": "onProblem",
		"showReuseMessage": false,
	},
	"isBackground": true,
	"options": {
		"cwd": "${workspaceFolder}/Specifications/YourTestProject.Tests"
	},
	"args": [
		"watch",
		"test",
		// maybe ignore integration tests or something
	],
	"problemMatcher": {
		"owner": "Hosting.Tests",
		"fileLocation": "absolute",
		"pattern": {
			"regexp": "^\\s*at (?:[^.]+\\.)+([^()]+)\\(\\) in (.*):line (\\d+)$",
			"message": 1,
			"file": 2,
			"line": 3,
		},
		"background": {
			"activeOnStart": true,
			"beginsPattern": "Started",
			"endsPattern": "Waiting for a file to change"
		}
	}
}
```

Replace “YourTestProject” with the actual name of your test project. These tasks will monitor your test projects and re-run tests whenever a file changes.

So, we’ve already got a task set up to run all our tests, but now we want to make it even better by continually running tests on a watch. The `dotnet watch` program does not support watching a whole solution, so you’ll have to set a task up per test-project.

Setting this up is helpful because it shortens that [red-green-refactor](https://dzone.com/articles/pattern-of-the-month-red-green-refactor) cycle, making you more efficient, happy and keeping your code neat and tidy.

How does it work?

The `isBackground` property is crucial By setting it to `true`, you’re telling VSCode that this task will keep running in the background. The problem-matcher will keep running and update VSCode with problems (adding and removing) when it sees their state change. This means you can continue coding without any interruptions while the tests run in the background. Pretty cool, right?

Now let’s dive into the `background` part of the `problemMatcher`. It’s all about tracking the beginning and ending of your background tasks. With `activeOnStart: true`, the problem matcher starts monitoring right away. The `beginsPattern` and `endsPattern` properties are used to identify when the task starts and ends. Your log will contain parts that aren’t interesting to the problem-matcher, so you want it to start when problems might appear. You also want it to know when it can end its lookout and tell VSCode what it’s found. With these two defined and the `isBackground` on your squigglies will appear and (hopefully more often) disappear as you code! Wonderful!

Combining the `isBackground` property and the `background` part of the `problemMatcher`, you get this magical synergy where your tests run continuously in the background. Your code editor highlights any issues directly in your code, so you can fix them on-the-fly. This way, you’re always on top of your game, catching bugs early and keeping your code in tip-top shape.

Imagine the time we’ll save! No more manual test runs every time you make a change. Just code away, and let the watch tasks handle the testing. This will make your development process smoother and help you create more reliable code with fewer hiccups. Nirvana.

### Run the ASP.NET Core Project with Watch

Alright, now let’s make our lives even easier by setting up a watch to run our ASP.NET Core project. This way, we can see our changes in action without having to restart the project manually every time. So let’s dive in!

```jsonc
{
	"label": "Run YourProject",
	"command": "dotnet",
	"dependsOn": [
		"maybe a docker compose or something?"
	],
	"group": "none",
	"isBackground": true,
	"detail": "Use this to run YourProject on http://localhost:YourPort",
	"presentation": {
		"echo": true,
		"reveal": "always",
		"focus": false,
		"panel": "shared",
		"showReuseMessage": true,
		"clear": false
	},
	"type": "process",
	"args": [
		"watch",
		"run",
		"--configuration",
		"LocalDev", // note this one
		"--project",
		"${workspaceFolder}/path/to/your/web.csproj"
	],
	"problemMatcher": {
		"owner": "csharp",
		"source": "msCompile",
		"applyTo": "closedDocuments",
		"fileLocation": "absolute",
		"pattern": {
			"regexp": "^(.*)\\((\\d+),(\\d+)\\):\\s+(error|warning|info)\\s+([A-Za-z0-9_]+)\\s*:\\s*(.*)$",
			"file": 1,
			"line": 2,
			"column": 3,
			"severity": 4,
			"code": 5,
			"message": 6
		},
		"background": {
			"activeOnStart": true,
			"beginsPattern": "^dotnet watch 🚀 Started$",
			"endsPattern": "^(The build failed|Starting up)"
		}
	}
}
```

Again, replace “YourProject” with the name of your project.

The task configuration for “Run YourProject” includes a non-standard configuration (`"LocalDev"`). This is super helpful because it prevents your watch task from interfering with locked files, like those pesky running tests. Neat, huh? Just remember to replace “YourProject” with the actual name of your project.

Now, you might be wondering, “Hey, what about that `$msCompile` problem matcher? Can I use it here?” Well, my friend, the default `$msCompile` problem matcher doesn’t play well with watches. But don’t worry! We’ve got a custom problem matcher with a `background` part, similar to the test-watch task we discussed earlier. This one works like a charm with watches and will keep your project running smoothly.

So, with this new task in place, your ASP.NET Core project will start up and automatically restart whenever you make changes to your files. No more tedious manual restarts! Just focus on your code, and let the watch task handle the rest.

You’re now all set up to code like a pro, with your tests and project running in the background, watching for changes and keeping you on track. Enjoy the boost in productivity and the joy of seamless development!

### Run all the tasks!

Wrapping up, we can make our lives even more convenient by creating a task that runs all watch tasks simultaneously. This nifty trick will save you time and keep your workflow smooth.

```jsonc
{
  "label": "run all the watch tasks",
  //...
  "dependsOn": [
	"watch YourTestProject1.Tests",
	"watch YourTestProject2.Tests",
   ],
	"presentation": {
		"reveal": "never",
		"focus": false,
		"panel": "shared",
		"showReuseMessage": false,
		"clear": false
	},
	"type": "shell",
	"problemMatcher": "$msCompile"
}

```

The “run all the watch tasks” configuration simply depends on all your test project watch tasks, like “watch YourTestProject1.Tests” and “watch YourTestProject2.Tests”. Just make sure to include all your test projects in the `dependsOn` array. With this setup, you can kick off all your watch tasks in one go, allowing you to focus on what matters most: writing awesome code!

If you have more than one test-project you’ll also now see why we might not actually always want to run all of them at once. I have about 10 such projects in my current VSCode, and spinning them all up certainly heats up the room. Which can be nice if my fingers are getting cold.

Once they’re all running they will discover any changes and start over, so if you’re working in a project that’s used by many other projects you can really enjoy the warmth and noise.

Personally I usually run all the test-projects before i push something, but when coding I often have just one or two of the most likely to break test-watch tasks running.

### **Bonus: Clean Task**

It’s can be nice to clean your solution periodically, which helps maintain a clutter-free development environment. For this purpose, here’s a “clean” task:

```jsonc
{
	"label": "clean",
	"command": "dotnet",
	"type": "process",
	"args": [
		"clean",
		"${workspaceFolder}/YourSolution.sln",
		"-v",
		"q"
	],
	"problemMatcher": "$msCompile"
}
```

This task uses the `dotnet clean` command to clean the solution, ensuring that old build artifacts are removed. If you do end up with locked files – this one will remove them.

### Wrapping Up

You now have a complete set of tasks for building, running tests, watching tests, hosting your ASP.NET Core project with watch, and cleaning your solution! By utilizing these tasks, you will improve your development experience and efficiency.

Hopefully these tasks will get you on the path to quick feedback from your tests and smooth running. Customize the tasks as needed for your specific projects!

_Happy coding!_