---
layout: post
title: "OneOf (with benchmarks)"
date: 2023-04-02 12:00:00 +01:00
author: "Tomas Ekeli"
permalink: 2023/04/oneof-with-benchmarks/
categories: [c#, dotnet, programming]
---

![decision trees](/assets/img/2023-04-02-oneof-with-benchmarks.png)

There’s a library called [OneOf](https://github.com/mcintyre321/OneOf) that gives something close to [discriminated unions](https://en.wikipedia.org/wiki/Tagged_union) in C# (like in for example [F#](https://fsharpforfunandprofit.com/posts/discriminated-unions/) and [TypeScript](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html?ref=hackernoon.com#discriminating-unions)). With it you can return a `OneOf` that wraps several return-types from your methods and handle them with some in-line lambdas.

For example, instead of using exception-based flow (_which you **really** should never use_) like this:

```csharp
public bool ExceptionBased()
{
  try
  {
    DoSomethingExceptional();
  }
  catch (Exception)
  {
    return false;
  }
  return true;
}

int DoSomethingExceptional()
{
  var v = _random.Next(1);

  if (v == 0)
  {
    throw new Exception();
  }
  return v;
}
```

You would write something like this in our contrived example:

```csharp
public bool OneOfBased()
{
  var result = DoSomethingOneOf();

  return result.Match(
    success => true,
    failure => false
  );
}

OneOf<int, Failure> DoSomethingOneOf()
{
  var v = _random.Next(1);

  if (v == 0)
  {
    return new Failure();
  }
  return v;
}

public record Failure();
```

To me this reads a lot better, and in larger code-bases it represents all the possible states a lot better than exceptions or (the more common case) returning an object and inspecting random things inside it to decide which code-flow to use.

### Caveat emptor

The order of the types in the `OneOf` (`int` and `Failure`, in this case) decide the order of the lambdas, and you just have to get it right. If you return something that you use in your lambda the compiler will probably catch it, but if it’s just marker-types like `Failure` you may run into problems.

I’ve gotten into the convention of returning the happy-case as the first type, and then progressing on to more and more off-the-path.

Also, if you have something you need to return many types from to catch many possible results your `OneOf<T, U, V, W, X, Y, Z...>` will get big and ugly. If you’re using that `OneOf` in several places it’ll really screw up your code.

For those kind of problems you can create your own return-type that inherits a `OneOfBase` and then use that. It will be a `class` instead of a `struct`, and therefore be slightly slower and more memory-intensive – but it’s nice to work with. To get this working for free you just use the `OneOf.SourceGenerator` -package and declare your return-type class like this (not the use of `partial` here to allow the generator to expand the `ReturnType`):

```csharp
[GenerateOneOf]
public partial class ReturnType : OneOfBase<int, Failure> {}
```

## Performance

How does this perform, in comparison to other ways of handling control flow?

I’ve made some benchmarks with [BenchmarkDotNet](https://github.com/dotnet/BenchmarkDotNet) to see how `OneOf` stacks up in comparison to a few different ways of handling flow. Like all micro-benchmarks this is likely not directly applicable to your code, but it can tell us something about how `OneOf` behaves.

You can download and run the [benchmarks](https://github.com/TomasEkeli/bencmarks-one-of) yourself from the GitHub repo.

I used the code above, with the exception-based flow as the worst performer (by far). I also made some variations that returned a nullable int and a tuple with a boolean and an int and an object with a boolean and an int.

One of my immediate concerns with using `OneOf` is that the failure-case constructs a new `Failure` on failure – so I also made benchmarks using a `static` instance of the `Failure`, and `ReturnType` returns with `new` and `static` `Failure`s.

I ran the benchmarks in a devcontainer with 12 processors and 32GB of memory, but please download the code and run it for yourself to see! Here are the results, ranked from fastest to slowest:

| Method | Time spent (ns) | Memory (B) | Slower by |
| --- | --- | --- | --- |
| Nullable | 2.629 | – | – |
| Tuple | 9.177 | – | 3.5x |
| Object | 10.523 | 24 | 3.9x |
| Record | 10.709 | 24 | 4.1x |
| OneOf-static | 11.769 | – | 4.5x |
| OneOf | 17.571 | 24 | 6.7x |
| ReturnType-static | 22.030 | 32 | 8.4x |
| ReturnType | 29.526 | 56 | 11.2x |
| Exception | 15 148.419 | 344 | 5 762.0x |

Benchmark results

## Conclusions

The fastest is to just use a nullable `int`. This does no allocation and works well if you only have two cases and can represent it well with existence or absence. A tuple is a little more expressive, and works very well for this kind of thing – they do get unwieldy (like `OneOf`) when you want to represent several things.

The `OneOf` -styles seem to impose an overhead over the built-in features (nullables, tuples, records and objects). They are nowhere near the exception-based -flow (_which you **really** should never use_), though. Using `static` instances for the returned types that do not contain data seems to be a worthwhile optimization for very little work.

Is the change in your code worth this overhead? For me I think the `OneOf` with a `static` instance is a really nice place to be – you get to use the nice `.Match` and `.Switch` -methods at a very low cost. For states that are representable by nullables I’d still use that.

If you don’t need many complex states the gain in readability may still be worth it. I think it’s more relevant whether you like the kind of code this makes you write than the performance-cost of it.

As always: instrument your code and find your _actual_ hot-spots before you rely on micro-benchmarks like this to decide what to use. And, remember, your highest cost may be CPU, Memory, Network or developer-time – act accordingly.

_Happy coding!_