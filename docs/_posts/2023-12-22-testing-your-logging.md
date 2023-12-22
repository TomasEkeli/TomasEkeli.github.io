---
layout: post
title: "Testing your logging in C#"
date: 2023-12-22 15:30
category: testing
author: Tomas Ekeli
tags: [csharp, tdd, testing, logging, mocking]
excerpt: When you want to test that you are logging correctly it can be tricky - as extension methods and statics are hard to mock. Here is a way to do it.
main-image: /assets/img/2023-12-22-testing-your-logging.webp
main-image-alt: Computer screen displaying C# code with a magnifying glass highlighting logging functions and a checklist of passed test cases.
---

![{{ page.main-image-alt }}]({{ page.main-image }})

When you write your code a sometimes disregarded part of the functionality is what gets logged and when. As you write code that needs to log to some specific level, or where logs are an important part of the functionality, you should also test that you are logging correctly.

## Verifying logging can be tricky

The problem is that logging is often done through static methods or extension methods in C#, and these are hard to mock. Your actual code might look something like this, logging with the [`Microsoft.Extensions.Logging`](https://www.nuget.org/packages/Microsoft.Extensions.Logging/) -library:

```csharp
using Microsoft.Extensions.Logging;
// ... other usings to get IService and Result

public class Thing(ILogger _logger, IService _dependency)
{
    public async Task<Result> DoTheThing()
    {
        _logger.LogInformation("Doing something");
        try
        {
            return Result.Success(await _dependency.DoSomething());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Something went wrong");
            return Result.Failure;
        }
    }
}
```

If you want to have a test that verifies that the logging is done correctly, you need to mock the logger. This is not hard, you just mock the `ILogger` -interface, but the `LogInformation` and `LogError` -methods are *extension methods*, and you can't mock extension methods. You can't mock static methods either, so what do you do?


## Mocking and extension methods

You can find lots of suggestions on the internet to mock out the methods on the actual `ILogger` -interface that the extension methods call, but *that is not a good idea*. Mocking like that means you are tying your tests to the *inner details* of the extension methods. You should not need to know how the extension methods work to test your code! Depending on inner workings leaves you open to breaking changes in the extension methods, and it makes your tests harder to read.

Instead - take a step back and think about what you're actually trying to test. You don't care about how the message is written, you just want to test that the correct log message is written, and that it is written at the correct log level. What you really need is the log-output in some way.

## MELT
This is just what [MELT](https://github.com/alefranz/MELT) gives you! MELT is a library that lets you work with the standard `Microsoft.Extensions.Logging` -library, but lets you run your tests and capture the logged output. Then you verify that the output (which is what you actually care about) is correct. This frees you up from knowing *how* the logging actually happens under-the-hood, and you can assert on the output instead. [Here's a great post on it](https://alessio.franceschelli.me/posts/dotnet/how-to-test-logging-when-using-microsoft-extensions-logging/).

In this is an example [XUnit](https://github.com/xunit/xunit) test that verifies that the correct log message is written, with [NSubstitute](https://nsubstitute.github.io/) and [Shouldly](https://docs.shouldly.org/) for mocking and assertions:

```csharp
using MELT;
using Microsoft.Extensions.Logging;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Shouldly;
using Xunit;

public class ThingLogsAsExpected
{
    [Fact]
    public async Task DoSomething_LogsCorrectMessage()
    {
        // Arrange
        var loggerFactory = TestLoggerFactory.Create();
        var logger = loggerFactory.CreateLogger<Thing>();

        var dependency = Substitute.For<IService>();
        dependency.DoSomething().Throws(new Exception("Boom!"));

        var system_under_test = new Thing(logger, dependency);

        // Act
        await system_under_test.DoTheThing();

        // Assert
        loggerFactory
            .Sink
            .LogEntries
            .ShouldContain(logEntry => logEntry.LogLevel == LogLevel.Error
                && logEntry.Exception != null
                && logEntry.Exception.Message == "Boom!"
                && logEntry.Message == "Something went wrong");
    }
}
```

## A handy base class for your tests
The access to the `TestLoggerFactory` and its `Sink` -property is what gives you access to the logged output. Personally I find this direct use a bit too verbose - so I usually create a super-class for my tests that let me access it in a more convenient way:

```csharp
using MELT;
using Microsoft.Extensions.Logging;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Shouldly;
using Xunit;

public abstract class TestsWithLogging
{
    protected ITestLoggerFactory LoggerFactory = TestLoggerFactory.Create();
    protected IEnumerable<LogEntry> Logs => LoggerFactory.Sink.LogEntries;

    public TestsWithLogging() => LoggerFactory.Sink.Clear();
}

public class WhenTheDependencyThrows : TestsWithLogging
{
    readonly IService _dependency;
    readonly ILogger<Thing> _logger;
    readonly Thing _system_under_test;
    readonly Result _result;

    public WhenTheDependencyThrows()
    {
        // Arrange
        _dependency = Substitute.For<IService>();
        _logger = LoggerFactory.CreateLogger<Thing>();

        _system_under_test = new Thing(_logger, _dependency);

        _dependency.DoSomething().Throws(new Exception("Boom!"));

        // Act
        _result = _system_under_test.DoTheThing().Result;
    }

    // each Fact is an assertion
    [Fact]
    public void DoSomething_LogsTheExpectedError() =>
        Logs
            .ShouldContain(logEntry => logEntry.LogLevel == LogLevel.Error
                && logEntry.Exception != null
                && logEntry.Exception.Message == "Boom!"
                && logEntry.Message == "Something went wrong");

    [Fact]
    public void DoSomething_LogsTheExpectedInformation() =>
        Logs
            .ShouldContain(logEntry => logEntry.LogLevel == LogLevel.Information
                && logEntry.Message == "Doing something");
}
```

This way I can access the `Logs` -property directly in the test, and verify that it contains what I expect. By clearing the logs before each test each run gets their own log and the tests won't affect each other.

This way of writing tests with the assertion and the act in the constructor is a bit unusual, but I find it very convenient. It makes the tests very readable, and it makes it easy to add or remove assertions.

If you're using NUnit you can do the same thing with a `OneTimeSetUp` -method, and if you're using MSTest you can do the same thing with a `[TestInitialize]` -attribute. I prefer XUnit, as each Fact is inherently separate, but you can do this with any test framework. Just be careful with any statics.

## Conclusion
When you want to test that you are logging correctly it can be tricky - as extension methods and statics are hard to mock. By using MELT you can test that the correct log message is written, and that it is written at the correct log level. This frees you up from knowing how the logging actually happens under-the-hood, and you can specify just what you are interested in.

You may not need or want to test your logging, but if you do - MELT is a great way to do it!

## P.S.: Performance and memory when logging

The example Thing here uses the extension-methods from the `Microsoft.Extensions.Logging` -library directly in the code. This works, and is often what we do when we are not massively concerned with performance.

If you are you should [generate log-methods](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) using the `LoggerMessage` -attribute. This will generate a static method that you can call instead of the extension methods on `ILogger`. It is much faster and uses less memory (particularly when you log values).

Note that for this to work your class must be partial (to allow the generated code to "take over" for the log-methods). Example:

```csharp
public partial class ThingWithPerformantLogging(
    ILogger _logger,
    IService _dependency)
{
    public async Task<Result> DoTheThing()
    {
        LogDoingSomething(_logger);
        try
        {
            return Result.Success(await _dependency.DoSomething());
        }
        catch (Exception ex)
        {
            LogDoingSomethingFailed(_logger, ex);
            return Result.Failure;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Doing something")]
    public static partial void LogDoingSomething(ILogger logger);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Something went wrong")]
    public static partial void LogDoingSomethingFailed(
        ILogger logger,
        Exception ex);
}
```