---
layout: post
title: Implementing RFC 9457: Problem Details for HTTP APIs in ASP.NET
date: 2025-09-26 17:29 +0200
category: dotnet
author: Tomas Ekeli
tags: [dotnet, aspnet, development, http, standards, rfc, api]
excerpt: Tell your clients what went wrong, not just that something went wrong.
main-image: /assets/img/2025-09-26-problem-details.webp
main-image-alt: "A computer monitor displaying an error message with a sad face emoji. Text overlay reads Implementing RFC 9457: Problem Details for HTTP APIs in ASP.NET."
---

![{{ page.main-image-alt }}]({{ page.main-image }})

## HTTP Status codes are not enough

When we implement HTTP APIs we can deal with errors in many ways. The HTTP protocol has a set of [status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status) that we can use to indicate what went wrong, and we should certainly use those!

Aside: there's a special place reserved for developers who use `200 OK` for everything, including errors. Don't be that developer. No, it is not OK. Never. Stop it!

| Status Code family  | Meaning        | Informally                    |
|---------------------|----------------|-------------------------------|
| 1xx                 | Informational  | Go on...                      |
| 2xx                 | Success        | Yay!                          |
| 3xx                 | Redirection    | You're in the wrong place     |
| 4xx                 | Client errors  | Your mistake                  |
| 5xx                 | Server errors  | My mistake                    |

The most basic was is to return a 200 if everything is OK, and a 500 if something went wrong. This is, however, not very informative. A 500 means "Internal Server Error", which is not very helpful to the client. It does not tell the client what went wrong, or how to fix it.

It is slightly better to use more specific status codes. The simple act of dividing errors into 4xx (client errors) and 5xx (server errors) is a good start. Using `400 Bad Request` for invalid input, `401 Unauthorized` for missing or invalid authentication, `403 Forbidden` for lack of permissions, `404 Not Found` for missing resources, and so on, is even better.

There are a lot of status codes to choose from, but even so you're likely to find yourself with a case that doesn't quite fit - or you would like to be more specific about what went wrong.

When a client submits a form with validation-errors, for example. It is good to return a `400 Bad Request`, but it would be even better to tell the client which fields were invalid, and why.

## Problem Details to the rescue

[RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) defines a standard way to return more information about errors in HTTP APIs. The RFC defines a JSON format for the response body that can be used to provide more information about the error. It replaces the older [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807.html) which defined a similar format, but was less flexible. These RFCs were published in July 2023 and March 2016 respectively. That's right, this has been around for nearly 10 years at the time of writing!

These RFCs don't change the status codes, you still return them as normal, but they talk about what you should include in the response body to provide more information about the error.

Sure, you *can* just return an empty body, or come up with your own format, but using a standard format has many advantages:
- Clients can be written to understand the standard format, and can handle errors in a consistent way.
- It is easier to document your API, as you can refer to the standard format.
- It is easier to test your API, as you can use standard tools to generate and validate requests and responses.
- It is much easier to integrate with other systems, as they can understand the standard format.
- **You don't have to invent your own format.**
  - And these RFCs have already considered all the things your format would forget
  - Seriously - you're not that special. Use the standard.

### The Problem Details format

The Problem Details format is a JSON object that looks like this (example from the spec):

```json
{
  "type": "https://example.com/probs/out-of-credit",
  "title": "You do not have enough credit.",
  "status": 403,
  "detail": "Your current balance is 30, but that costs 50.",
  "instance": "/account/12345/msgs/abc",
  "balance": 30,
  "accounts": [
    "/account/12345",
    "/account/67890"
  ]
}
```

This includes `type`, `title`, `status`, `detail` and `instance` properties, which are defined in the RFC. It also includes additional properties, like `balance` and `accounts`, which are not defined in the RFC, but can be used to provide more information about the error specific to the case.

A common extension to the Problem Details format is to include a list of errors, (e.g. validation-errors for multiple fields) like this:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "detail": "The submitted form was not valid.",
  "status": 400,
  "errors": {
    "Language": [
      "The Language field is required.",
      "'Language' must not be empty."
    ],
    "Tags": [
      "The Tags field is required."
    ],
    "CreatedBy": [
      "The CreatedBy field is required.",
      "'Created By' must not be empty."
    ],
    "Reference": [
      "The Reference field is required.",
      "'Reference' must not be empty."
    ]
  },
  "traceId": "00-84c9d447edf8d4bcba82187356336e76-ca92c022b7da8472-01"
}
```

With this information developers using you API can more easily understand what went wrong, and how to fix it. They can also use the errors to decorate the user-interface with errors, helping the user fix their input.

Note that this particular style of errors is not defined in the RFC, and I've seen many different variations of this. Since it is not defined in the RFC, you can should work with your clients to agree on a format that works for you.

## Implementing Problem Details in ASP.NET

ASP.NET has built-in support for Problem Details, so you can use it out of the box. You can return a `ProblemDetails` object from your controller actions, and ASP.NET will automatically serialize it to JSON and set the appropriate status code.

You have to add the `Microsoft.AspNetCore.Mvc.ProblemDetails` package to your project.

```sh
dotnet add package Microsoft.AspNetCore.Mvc.ProblemDetails
```


This is pretty easy to do - you just add the following code in your application startup (usually in `Program.cs`):

```csharp
builder.Services.AddProblemDetails();
```

This makes any problems with Asp.NET [automatically return Problem Details responses](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api?view=aspnetcore-9.0&tabs=minimal-apis), and also any error responses that do not have a body. With this a `404 Not Found` will return a Problem Details response with the appropriate status code and a default message.

But, that middleware does not know what actually went wrong, and cannot provide any additional information. For that you have to do it yourself.

I like [Milan Jovanović's approach](https://www.milanjovanovic.dev/asp-net-core-web-api-error-handling-best-practices/), but I have an alternative approach that I prefer.

### The ProblemDetailer

What I want is for my controller to be able to return a `ProblemDetails` object with the appropriate status code and additional information, without having to write a lot of boilerplate code.

Here's a small example of how I want a controller action to look (you can do this with minimal APIs as well):

```csharp
using Microsoft.AspNetCore.Mvc;
using OneOf;
using OneOf.Types;

namespace ProblemDetailsExample;

[ApiController]
[Route("api/example")]
public partial class ExampleController(
    IProblemDetailer _problems,
    IExampleHandler _handler
) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetExample(
        Guid id,
        CancellationToken ct = default)
    {
        var maybeExample = await _handler.Get(id, ct);

        return maybeExample.Match(
            example => Ok(example),
            notFound => _problems.NotFound(
                detail: "Example not found",
                errors: new()
                {
                    ["id"] = id.ToString()
                }
            ),
            error => _problems.Error(
                detail: "Failed to get example",
                errors: new()
                {
                    ["message"] = error.Value,
                    ["id"] = id.ToString()
                }
            )
        );
    }
}

public record Example(
    Guid Id
);

public interface IExampleHandler
{
    Task<OneOf<Example, NotFound, Error<string>>> Get(
        Guid id,
        CancellationToken ct
    );
}

// just a silly example showing returning different results
public class ExampleHandler : IExampleHandler
{
    static readonly Guid _illegal = Guid.Parse(
        "00000000-0000-0000-0000-000000000001"
    );

    public Task<OneOf<Example, NotFound, Error<string>>> Get(
        Guid id,
        CancellationToken ct
    ) =>
        Task.FromResult<OneOf<Example, NotFound, Error<string>>>(
            id switch
            {
                var empty when empty == Guid.Empty =>
                    new NotFound(),
                var special when special == _illegal =>
                    new Error<string>(
                        "That ID is forbidden"
                    ),
                _ => new Example(id)
            }
        );
}
```

I am using [OneOf](https://github.com/mcintyre321/OneOf) that I have [written of earlier](https://www.eke.li/2023/04/oneof-with-benchmarks/) to represent the possible outcomes of the `GetExample` method. It can return an `Example`, a `NotFound`, or an `Error<string>`. I find this very useful for representing the possible outcomes of a method, and it works well with the Problem Details approach.

I feel this works well together and ends up with pretty clean code.

Here's my `IProblemDetailer` interface:

```csharp
using Microsoft.AspNetCore.Mvc;

namespace ProblemDetailsExample;

public interface IProblemDetailer
{
    BadRequestObjectResult BadRequest(
        string title = "Bad Request",
        string detail = "The request is invalid.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );

    NotFoundObjectResult NotFound(
        string title = "Not Found",
        string detail = "The requested resource was not found.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );

    ConflictObjectResult Conflict(
        string title = "Conflict",
        string detail = "The request could not be completed due to a conflict.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );

    ObjectResult Error(
        string title = "Error",
        string detail = "An unexpected error occurred.",
        Dictionary<string, string>? errors = null,
        string? instance = null,
        int statusCode = StatusCodes.Status500InternalServerError
    );

    UnprocessableEntityObjectResult UnprocessableEntity(
        string title = "Unprocessable Entity",
        string detail = "The request was well-formed but could not be processed.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );

    ObjectResult TooManyRequests(
        string title = "Too Many Requests",
        string detail = "Unable to process the request due to rate limiting.",
        Dictionary<string, string>? errors = null,
        string? instance = null,
        string? retryAfter = null
    );

    ObjectResult Gone(
        string title = "Gone",
        string detail = "The requested resource is no longer available.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );

    ObjectResult MethodNotAllowed(
        string title = "Method Not Allowed",
        string detail = "The HTTP method is not allowed for the requested resource.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    );
}
```

As you can see the caller can include a title, detail, errors, and instance, or nothing at all, and get a reasonable default response.

The implementation of the `IProblemDetailer` interface is straightforward, and populates the type based on the status code. The implementation is a bit repetitive to read, but is included here for reference:

```csharp

using System.Collections.Frozen;
using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using static Microsoft.AspNetCore.Http.StatusCodes;

namespace ProblemDetailsExample;

public class ProblemDetailer(
    IHttpContextAccessor _httpContextAccessor
) : IProblemDetailer
{
    public BadRequestObjectResult BadRequest(
        string title = "Bad Request",
        string detail = "The request is invalid.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );

        var (code, type) = GetType(
            Status400BadRequest
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        );
    }

    public NotFoundObjectResult NotFound(
        string title = "Not Found",
        string detail = "The requested resource was not found.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );

        var (code, type) = GetType(
            Status404NotFound
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        );
    }

    public ConflictObjectResult Conflict(
        string title = "Conflict",
        string detail = "The request could not be completed due to a conflict.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );
        var (code, type) = GetType(
            Status409Conflict
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        );
    }

    public ObjectResult Error(
        string title = "Error",
        string detail = "An unexpected error occurred.",
        Dictionary<string, string>? errors = null,
        string? instance = null,
        int statusCode = Status500InternalServerError
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );
        var (code, type) = GetType(statusCode);

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        )
        {
            StatusCode = statusCode
        };
    }

    public UnprocessableEntityObjectResult UnprocessableEntity(
        string title = "Unprocessable Entity",
        string detail = "The request was well-formed but could not be processed.",
        Dictionary<string, string>? errors = null,
        string? instance = null)
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );
        var (code, type) = GetType(
            Status422UnprocessableEntity
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        );
    }

    public ObjectResult TooManyRequests(
        string title = "Too Many Requests",
        string detail = "Unable to process the request due to rate limiting.",
        Dictionary<string, string>? errors = null,
        string? instance = null,
        string? retryAfter = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );

        if (retryAfter is not null)
        {
            ext["retryAfter"] = retryAfter;
            _httpContextAccessor
                .HttpContext
                ?.Response
                .Headers
                .Append(
                    "Retry-After",
                    retryAfter
                );
        }

        var (code, type) = GetType(
            Status429TooManyRequests
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        )
        {
            StatusCode = Status429TooManyRequests
        };
    }

    public ObjectResult Gone(
        string title = "Gone",
        string detail = "The requested resource is no longer available.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );
        var (code, type) = GetType(
            Status410Gone
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        )
        {
            StatusCode = Status410Gone
        };
    }

    public ObjectResult MethodNotAllowed(
        string title = "Method Not Allowed",
        string detail = "The HTTP method is not allowed for the requested resource.",
        Dictionary<string, string>? errors = null,
        string? instance = null
    )
    {
        var (inst, ext) = GetContext(
            _httpContextAccessor.HttpContext,
            errors,
            instance
        );
        var (code, type) = GetType(
            Status405MethodNotAllowed
        );

        return new(
            new ProblemDetails
            {
                Title = title,
                Detail = detail,
                Status = code,
                Type = type,
                Instance = inst,
                Extensions = ext
            }
        )
        {
            StatusCode = Status405MethodNotAllowed
        };
    }

    static (int, string) GetType(int statusCode)
    {
        if (StatusLinks.TryGetValue(statusCode, out var type))
        {
            return (statusCode, type);
        }

        return (
            Status500InternalServerError,
            StatusLinks[Status500InternalServerError]
        );
    }

    static (string, Dictionary<string, object?>) GetContext(
        HttpContext? context,
        Dictionary<string, string>? errors,
        string? possibleInstance = null
    )
    {
        var instance = possibleInstance
            ?? context?.Request.Path;
        var traceId = Activity.Current?.Id
            ?? context?.TraceIdentifier;

        return (
            instance ?? string.Empty,
            new()
            {
                ["traceId"] = traceId ?? string.Empty,
                ["errors"] = errors ?? []
            }
        );
    }

    static readonly FrozenDictionary<int, string> StatusLinks = new Dictionary<int, string>(24)
    {
        [Status400BadRequest]           = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.1",
        [Status401Unauthorized]         = "https://datatracker.ietf.org/doc/html/rfc7235#section-3.1",
        [Status402PaymentRequired]      = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.2",
        [Status403Forbidden]            = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.3",
        [Status404NotFound]             = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.4",
        [Status405MethodNotAllowed]     = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.5",
        [Status406NotAcceptable]        = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.6",
        [Status407ProxyAuthenticationRequired] = "https://datatracker.ietf.org/doc/html/rfc7235#section-3.2",
        [Status408RequestTimeout]       = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.7",
        [Status409Conflict]             = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.8",
        [Status410Gone]                 = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.9",
        [Status411LengthRequired]       = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.10",
        [Status412PreconditionFailed]   = "https://datatracker.ietf.org/doc/html/rfc7232#section-4.2",
        [Status413PayloadTooLarge]      = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.11",
        [Status414UriTooLong]           = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.12",
        [Status415UnsupportedMediaType] = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.13",
        [Status416RangeNotSatisfiable]  = "https://datatracker.ietf.org/doc/html/rfc7233#section-4.4",
        [Status417ExpectationFailed]    = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.14",
        [Status418ImATeapot]            = "https://datatracker.ietf.org/doc/html/rfc7168#section-2.3.3",
        [Status422UnprocessableEntity]  = "https://datatracker.ietf.org/doc/html/rfc4918#section-11.2",
        [Status429TooManyRequests]      = "https://datatracker.ietf.org/doc/html/rfc6585#section-4",
        [Status500InternalServerError]  = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.1",
        [Status501NotImplemented]       = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.2",
        [Status502BadGateway]           = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.3",
        [Status503ServiceUnavailable]   = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.4",
        [Status504GatewayTimeout]       = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.5",
    }.ToFrozenDictionary();
}
```

I hope this helps you implement Problem Details in your ASP.NET applications!