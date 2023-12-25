---
layout: post
title: "Comparing records with collections in C#"
date: 2023-12-25 23:30 +0100
category: dotnet
author: Tomas Ekeli
tags: [csharp, development, dotnet, records, collections]
excerpt: Records have surprising equality-semantics when they contain collections. Here is a simple way to fix it.
main-image: /assets/img/2023-12-25-comparing-records-with-collections.webp
main-image-alt: "Two silhouettes with a glowing connection between them representing equal C# records."
---

![{{ page.main-image-alt }}]({{ page.main-image }})

Records are a great thing in C#. They are immutable, and give you "value semantics" for comparison. This means that two records with the same values are considered equal, even if they are different instances. This saves you a lot of time and troublesome code!

```csharp
public record Person(
    string FirstName,
    string LastName);

var person1 = new Person("Tomas", "Ekeli");
var person2 = new Person("Tomas", "Ekeli");

// will print "true"
Console.WriteLine(person1 == person2);
```

Wonderful, but it all falls down if you have a collection of some sort as a property in your record. Then the comparison will only compare the references of the collections, not the contents. This is because the default implementation of `Equals` and `GetHashCode` for collections only compares the references.

```csharp
public record PersonWithNickname(
    string FirstName,
    string LastName,
    List<string> Nicknames);

var person1 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new List<string> { "Tommy" }
);

var person2 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new List<string> { "Tommy" }
);

// will print "false"
Console.WriteLine(person1 == person2);

// referencing person1's nicknames
var person3 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    person1.Nicknames
);

// will print "true"
Console.WriteLine(person1 == person3);
```

This is (in my experience) usually not what I want. When I use a record I am almost always using it for its value semantics. I want to compare the contents of the collections, not the references. So how do we do that?

We could implement our own collections that override `Equals` and `GetHashCode` to compare the contents. But that is a lot of work, and it is easy to get wrong, and will be a chore to maintain.

But, there *is* such a library already out there that we can just use, it is called [Nemesis.Essentials](https://github.com/nemesissoft/Nemesis.Essentials) and you can install it from NuGet. It is MIT licensed, so you can use it in your projects without any worries about licensing.

```powershell
dotnet add package Nemesis.Essentials
```

You change your record to use the `ValueCollection<T>` from the library instead of `List<T>`. Then you get the value semantics you want. With the [new collection expressions in C# 12](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12#collection-expressions), it is even easier to use.

```csharp

using Nemesis.Essentials.Collections;

public record PersonWithNickname(
    string FirstName,
    string LastName,
    ValueCollection<string> Nicknames);

var person1 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new(new[] { "Tommy" })
);

var person2 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new(new[] { "Tommy" })
);

// will print "true"
Console.WriteLine(person1 == person2);

// with c# 12 collection expressions
var person3 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    // requires c# 12
    new([ "Tommy" ])
);

// will print "true"
Console.WriteLine(person1 == person3);
```

There are a lot of other things in that library as well, but this one seemed very helpful. I hope you find it useful as well!
