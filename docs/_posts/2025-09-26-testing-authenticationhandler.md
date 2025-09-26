---
layout: post
title: "Testing an AuthenticationHandler in ASP.NET"
date: 2025-09-26 13:41 +0200
category: dotnet
author: Tomas Ekeli
tags: [csharp, development, dotnet, aspnet]
excerpt: How to set up an AuthenticationHandler for testing
main-image: /assets/img/2025-09-26-testing-authenticationhandler.webp
main-image-alt: "A computer monitor displaying colourful lines labeled AuthenticationHandler, with a magnifying glass showing a question mark in front and a shield with a checkmark. Text overlay reads Testing an AuthenticationHandler in ASP.NET."
---

![{{ page.main-image-alt }}]({{ page.main-image }})

## Our AuthenticationHandler

We have an `AuthenticationHandler` that looks like this to handle authentication (this is just a silly example randomly allowing or denying authentication):

```csharp


public partial class RandomAuthenticationHandler
: AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemaName = "Random";

    readonly bool _enabled;
    readonly double _chance;
    readonly ILogger<RandomAuthenticationHandler> _logger;

    public RandomAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory loggerFactory,
        UrlEncoder encoder,
        IOptions<RandomSettings> randomSettings
        ) : base(
            options,
            loggerFactory,
            encoder
        )
    {
        _logger = loggerFactory
            .CreateLogger<RandomAuthenticationHandler>();

        if (randomSettings?.Value is null)
        {
            LogMissingConfiguration(_logger);
            throw new InvalidOperationException(
                "Application misconfigured: No RandomSettings"
            )
        }
        _randomSettings = randomSettings.Value;
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!_randomSettings.Enabled)
        {
            LogDisabled(_logger);
            return Task.FromResult(AuthenticateResult.NoResult());
        }


        if (Random.Shared.NextDouble() < _randomSettings.Chance)
        {
            LogRandomlyFailing(_logger);
            return Task.FromResult(
                AuthenticateResult.Fail("Not authenticated")
            );
        }

        LogRandomlySucceeding(_logger);
        return Task.FromResult(
            AuthenticateResult.Success(
                new AuthenticationTicket(
                    principal: new ClaimsPrincipal(
                        new ClaimsIdentity(
                            authenticationType: SchemaName,
                            claims:
                            [
                                new Claim(
                                    ClaimTypes.NameIdentifier,
                                    Guid.NewGuid().ToString()
                                ),
                                new Claim(
                                    ClaimTypes.Name,
                                    "Random User"
                                ),
                            ]
                        )
                    ),
                    authenticationScheme: SchemaName
                )
            )
        );
    }

    // logging omitted for brevity
}

/**
 * Bind this in your IoC setup
 **/
public class RandomSettings
{
    public bool Enabled { get; set; }

    [Range(0.0, 1.0)]
    public double Chance { get; set; }
}
```

How would we test such a thing? Put aside that this is a silly example, and randomness it inherently hard to test. How do we set up the `AuthenticationHandler` in a test?

## Setting up the test

We're going to need to instantiate our `RandomAuthenticationHandler` in a test. We can do that fine. In the following example I'm using [NSubstitute](https://nsubstitute.github.io/) for mocking, and [xUnit](https://xunit.net/) for the test framework. The logging is set up in a base class called `Test_with_logs` that I use in many tests, you can read about that in [this post](https://www.eke.li/testing/2023/12/22/testing-your-logging.html).

```csharp
public class Given_a_RandomAuthenticationHandler
: Test_with_logs
{
    protected IOptionsMonitor<AuthenticationSchemeOptions> _options_monitor;
    protected IOptions<RandomSettings> _random_settings;
    protected UrlEncoder _url_encoder;

    protected RandomAuthenticationHandler _handler;

    protected Given_a_RandomAuthenticationHandler()
    {
        _options_monitor = Substitute
            .For<IOptionsMonitor<AuthenticationSchemeOptions>>();

        _options_monitor
            .Get(Arg.Any<string>())
            .Returns(new AuthOptions());

        _url_encoder = Substitute.For<UrlEncoder>();

        _random_settings = Options.Create(
            new RandomSettings
            {
                Enabled = true,
                Chance = 0.2//
            }
        );

        _handler = new RandomAuthenticationHandler(
            _options_monitor,
            TestLoggerFactory,
            _url_encoder,
            _random_settings
        );
    }
}

public class When_authenticating_randomly
: Given_a_RandomAuthenticationHandler
{
    [Fact]
    public async Task It_should_not_crash()
    {
        await _random_authentication_handler.AuthenticateAsync();

        true.Should().BeTrue();
    }
}

```

Our simple test fails, though - as the `AuthenticationHandler` needs to be initialised before use. We can do that by calling the `InitializeAsync` method. This is the part that aspnet calls before our `HandleAuthenticationAsync` method is called. Let's add that to our test base-class (the `Given` -class):


```csharp

public class Given_a_RandomAuthenticationHandler
: Test_with_logs
{
    // ...previously shown code omitted for brevity...

    protected async Task Initialize_with(HttpContext context)
    {
        await _handler.InitializeAsync(
            new AuthenticationScheme(
                RandomAuthenticationHandler.SchemaName,
                null,
                typeof(RandomAuthenticationHandler)
            ),
            context
        );
    }
}
```

Now we can call that in our test, and pass in a `HttpContext` that we set up for the test. Let's do that:

```csharp

public class When_authenticating_randomly
: Given_a_RandomAuthenticationHandler
{
    readonly DefaultHttpContext _context = new();

    [Fact]
    public async Task It_should_return_a_result()
    {
        await Initialize_with(_context);
        var result = await _handler.AuthenticateAsync();

        result.Should().NotBeNull();
    }

    [Fact]
    public async Task It_should_log_something()
    {
        await Initialize_with(_context);
        await _handler.AuthenticateAsync();

        Logs
            .Should()
            .NotBeEmpty();
    }

    // more tests here...
}
```

And there you have it! Now you can manipulate the `HttpContext` as you like before you initialize, and test your `AuthenticationHandler` in isolation.

Exercise for the reader: write a test wherein the `_random_settings.Value` is null verifying that the `InvalidOperationException` is thrown.

Happy testing!