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

**2023-12-29: There's a update in the end of this post**

## Use records for value semantics

Records are a great thing in C#. They are immutable, and give you "[value semantics](https://en.wikipedia.org/wiki/Value_semantics)" for comparison. This means that two records with the same values are considered equal, even if they are different instances. This saves you a lot of time and troublesome code!

```csharp
public record Person(
    string FirstName,
    string LastName);

var person1 = new Person("Tomas", "Ekeli");
var person2 = new Person("Tomas", "Ekeli");

// will print "true"
Console.WriteLine(person1 == person2);
```

There are some caveats to this, but they are not the focus of this post. You can read more about them [here](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record#value-equality).

## The problem with collections

Wonderful, but it all falls down if you have a collection of some sort as a property in your record. Then the comparison will only compare the references of the collections, not the contents. This is because the default implementation of `Equals` and `GetHashCode` for collections only compares the references.

```csharp
public record PersonWithNickname(
    string FirstName,
    string LastName,
    List<string> Nicknames);

var person1 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    [ "Tommy" ]
);

var person2 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    [ "Tommy" ]
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

## Solution: Nemesis.Essentials

We could implement our own collections that override `Equals` and `GetHashCode` to compare the contents. But that is a lot of work, and it is easy to get wrong, and will be a chore to maintain.

But, there *is* such a library already out there that we can just use, it is called [Nemesis.Essentials](https://github.com/nemesissoft/Nemesis.Essentials) and you can install it from NuGet. It is MIT licensed, so you can use it in your projects without any worries about licensing.

```powershell
dotnet add package Nemesis.Essentials
```

You change your record to use the `ValueCollection<T>` from the library instead of `List<T>`. Then you get the value semantics you want. With the [new collection expressions in C# 12](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12#collection-expressions), it is even easier to use.

```csharp

using Nemesis.Essentials.Design;

public record PersonWithNickname(
    string FirstName,
    string LastName,
    ValueCollection<string> Nicknames);

var person1 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new([ "Tommy" ])
);

var person2 = new PersonWithNickname(
    "Tomas",
    "Ekeli",
    new([ "Tommy" ])
);

```

There are a lot of other things in that library as well, but this one seemed very helpful. I hope you find it useful as well!

## Update 2023-12-29 Danger! Caveats!

As has been pointed out to me by [Leszek Ciesielski](https://hachyderm.io/@skolima) - there are some caveats to [this approach](https://plud.re/notes/9nt0ow2gvup4nb33). While it *does* provide the equality semantics I am after, it comes with consequences.

`ValueCollection` inherits [System.Collections.ObjectModel.Collection<T>](https://learn.microsoft.com/en-us/dotnet/api/system.collections.objectmodel.collection-1?view=net-8.0), a *mutable* data-structure.

This is not what we want in a record, as their immutability is why they can have value semantics in the first place. And, since the collection can be part of how the record is compared and hashed - this means that the record's hash-code can change. This is a problem. It can also affect serialization -performance, which is bad.

Whether or not these problems are deal-breakers for you depends on your use-case. Do you need to serialize and deserialize your records? Do you need to use them as keys in a dictionary? Will you never mutate the collection? If the answer to any of these questions is "yes", then you should probably *not* use this approach.

I still think that the library is useful, but it is not a silver bullet. If anyone ever finds one of those fabled silver bullets - please tell me! I will probably use it in some cases, but not in others.

An alternative solution is to use [System.Collections.Immutable.ImmutableList<T>](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablelist-1) instead of `ValueCollection<T>`. This is an immutable data-structure, and it has the equality semantics we want. But, it is not a drop-in replacement for `List<T>`, so you will have to change your code to use it. It also has some performance implications, so you need to consider those carefully before you use it.

There is also the [System.Collections.Frozen](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen) -namespace in dotnet8, which spends more time when constructing the collection, but is immutable from then on and offers [better performance after creation](https://davecallan.com/dotnet-8-frozendictionary-benchmarks/). They only have Dictionaries and Sets, though - no Lists.