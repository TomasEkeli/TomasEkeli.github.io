---
layout: post
title: On microservices
date: 2023-09-30 12:00
category: architecture
author: Tomas Ekeli
tags: [microservices, architecture, dev]
excerpt: Much has been written about microservices. I have thoughts on when they make sense and the consequences of using them.
main-image: /assets/img/2023-09-30-on-microservices.webp
main-image-alt: A split monolith with a smaller statue in front of it
---

![{{ page.main-image-alt }}]({{ page.main-image }})

Much has been written about [microservices](https://en.wikipedia.org/wiki/Microservices) as an architectural pattern. I have worked with them for a many years, and have thoughts on when they make sense and the consequences of using them.

## What are microservices?

Microservices are a way of structuring a system into smaller parts. The idea is that each part is small enough to be managed by a small team, and that the parts can be developed and deployed independently of each other.

I've heard them defined in many ways - are they a services that does "just one thing", or a service that is "so small that it makes more sense to re-write it than change it"? Are they perhaps a service that is so small that it is easily replaced by a third-party service? Where is the line between a micro- and a nano-service?

The exact definition does not really matter, the point is that the general move towards smaller services may be beneficial.

## How do we build large systems?

The most efficient way of creating a software system would be for one extremely competent person to create the entire system as one deployable unit. An entire system made by one genius who understands the whole system and domain and can make all the right decisions.

Doing this would mean that a large system that requires 15 person-years to create would take 15 actual years to create. Creating it would occupy one genius for those 15 years. In reality we do not make systems like this. We don't have geniuses, and we don't have 15 years to make them.

Instead we have teams of people, and we have deadlines. We have to make compromises, and we have to make sure that the system we make is maintainable. We have to make sure that the system can change as the world changes around it.

> Any organization that designs a system (defined broadly) will produce a design whose structure is a copy of the organization's communication structure.
> - [Melvin Conway](https://en.wikipedia.org/wiki/Conway%27s_law)

This is a well-known law in software development, oft quoted to explain why systems end up the way they do. It is also used to explain why microservices may be good idea.

When we add more people (of various skill-levels) to a project we need to make sure that they can work together. They must be able to work independently on different parts of the system without stepping on each other's toes. Thus, we create smaller areas within our system that each group of people work on. We call these areas "modules", or "components", or "services".

It is easier to work in such a system when we are strict about how the modules interact, the defined interfaces between them. We can then make sure that each module owns a small part of the system, and that it does not need to know about the rest of the system.

As long as we keep all these modules together in the same code-base we call this a "monolith". This is the default way of creating software, and it works well for many systems. In fact, I recommend that all systems start out as a monolith.

## Why keep the monolith?

There are good reasons to create and maintain a system as a monolith for as long as possible. Please consider these when deciding whether to split up your system into smaller services.

### One unit
With a monolith all the code lives in the same deployable unit, usually in the same code-base. It is simpler for the developers to find, read and (hopefully) understand the code. This makes it easier to change the code, as you can change the code in one place and be sure your change affects the entire system.

### Version consistency
Since all the code deploys as a single unit you are sure of what code you are running. Your server runs the exact same code as the one you developed, tested and accepted. Any differences are only because of configurations and such. There should be no surprises when you deploy a single unit.

### Technological consistency
Usually a monolith is a single tech-stack, as in all the code is in the same language and uses the same libraries. This can make it easier to find people who can work on the system, and it makes it easier to move people around within the system. If everyone knows Java and everything is Java they can work on everything.

### Easier to debug
When you detect an error you have one solution to blame and to trace the error to. This is often overlooked as a major benefit, but it is a big one. The ability to trace a logged error to a single line of code and be sure that it is the only place where the error can be is a huge boon.

### Faster to run
Since everything usually runs in one (logical) process with a monolith they are also quicker to run. Any multi-service architecture has some overhead in communication between the services. This will slow down the entire system.

### Less code
In a multi-service architecture you must create logic around the interactions between services. You must handle timeouts, down-time, errors, retries, etc. This is difficult code to get right that you will have to write and maintain, and it is code that does not add direct value to the business.

If you are not careful and use patterns like [circuit-breakers](https://martinfowler.com/bliki/CircuitBreaker.html) and [event-driven architectures](https://martinfowler.com/articles/201701-event-driven.html) your system will, at best, be as resilient and reliable as the least reliable service in your system.

### Easier to deploy
Since a monolith is a single deployable unit it is also (usually) easier to deploy. You can deploy the entire system at once, and you can be sure that the entire system acts as a unit. You can also be sure that the entire system is running the same version of the code.

## Why split up?

Splitting up to smaller services carries with it a whole host of benefits. We know that people are inherently bad at creating, understanding, maintaining and changing large systems. Smaller services takes this premise seriously, in essence saying "if creating large systems is hard - let's create smaller systems".

### Fewer spooky bugs at a distance
Working in a monolith can be scary, as changes to one part of the system may "bubble up" as strange bugs in seemingly unrelated parts of the monolith. This is because the entire system is running in the same process, and a bug in one part of the system may affect another part of the system.

Shared global writeable state and unclear patterns of interaction between the different parts of the system are usually the culprits here. By enforcing interfaces between the services and not sharing state (they are in different processes, probably on different machines) these kinds of bugs are less likely to occur.

### Scale
A monolith is a single deployable unit, and it is usually deployed as a single process. This means that you cannot scale parts of the system independently. If you have a part of the system that is used more than the rest of the system you will have to scale the entire system to handle the load. If you have problems with scale and you have a monolith you will have to scale the entire system, even if only a small part of it is under load.

### Independent development
If you have a large system with many teams working on it you will have to make sure that the teams can work independently. With a monolith you need to make sure that the teams can work on different parts of the system without stepping on each other's toes. This is possible, but it is not easy.

With multiple services your developers can work on different services without having to worry about the rest of the system, as long as they (and everyone else) adhere to the defined interfaces between the services. There are fewer merge-conflicts and development-flow for each service becomes smoother.

### Independent deployment
If you have a large system with many teams working on it you will have to make sure that the teams can deploy their changes independently. Instead of defining (release trains)[https://en.wikipedia.org/wiki/Software_release_train] and having to coordinate the deployment of the entire system you can deploy each service independently. This means that you can deploy the changes to the service that is under load without having to deploy the entire system.

To be able to deploy independently you do need to have a mature dev-ops organization and and deal with multiple versions of the same service running at the same time. This is not easy, but it is possible.

### Independent technology
If you have a large system with many teams working on it you will have to make sure that the teams can work with the technologies they want to work with. With a monolith you need to make sure that the teams can work with the same technologies, and that they can work with the same versions of the same technologies. This is possible, but it is not always easy or desirable.

By splitting up the system into smaller services you can let each team work with the technologies they want to work with and that fit their domain. This means that you can have a team working with Java, another with C#, and yet another with Python and one with PHP. You can also have a team working with the latest version of a technology, and another team working with an older version of the same technology.

### Independent scaling
If you have a large system with many teams working on it you will have to make sure that the teams can scale their parts of the system independently. With a monolith you need to make sure that the teams can scale the entire system, even if only a small part of it is under load. This is possible, but it is not easy.

With multiple services you can scale the services that are under load without having to scale the entire system. This means that you can scale the service that is under load without having to scale the entire system. Conversely you can also restrict services that are particularly costly or resource-hungry if needed. This gives you flexibility in how you use your resources that a monolith cannot provide.

### Independent failure
If you have a large system with many teams working on it you will have to make sure that the teams can handle failure independently. With a monolith you need to make sure that the teams can handle the entire system failing, even if only a small part of it is under load.

With multiple services you need to handle failing services, and you are forced to treat all services as unreliable. This means that you need to handle services that are down, or slow, or that return errors. Done right (which is non-trivial) this gives your system as a whole a level of resilience and reliability that a monolith may struggle to provide.

### Differing runtime considerations
It is common to have different requirements for different parts of your system. Perhaps you are required to run certain parts in a certain region, or on-premises, or in a certain cloud. Perhaps you have different requirements for security, or for data-retention, or for performance. With a monolith you need to make sure that the entire system adheres to the strictest requirements. With multiple services you can have different services adhere to different requirements.

### Easier to understand
As your system (inevitably) grows and evolves it will take on new responsibilities and new features. It will also take on new developers. It tends to grow harder to understand, and harder to change. By splitting up the system into smaller services you can increase the likelihood that each service is understandable by a single person, and that each service is small enough to be changed by a single person.

### Repleaceability
If you have a system of services that interact in well-known and -defined ways you gain the ability to replace parts of that system while keeping the rest of the system intact. This means that you can replace a service with a new implementation or a third-party service. This requires that you have well-defined interfaces and protocols of interaction, and some way of routing information between your services that affords you the ability to replace a service with another.

### Team topology
This is a bit of a meta-reason, but it is a very important one. By splitting up your system into smaller services you can also split up your teams into smaller or different teams. This means that you can have teams that are small enough to be managed by a single person, and that you can have teams that are small enough to be fed by a single pizza.

Splitting a monolith into smaller services is usually predicated on setting up teams that reflect the service-landscape you want to create. This is a good thing, but it is also a hard thing. It is hard to know what the right team-topology is, and it is hard to change the team-topology once it is set up. It is also hard to change the team-topology once it is set up, and it is hard to know what the right team-topology is.

Setting up different teams and deciding how to split up the system is usually the job of the "architects" in your organization, and requires working with the leadership to transform the organization while keeping the system running.

This exercise is what is sometimes referred to as the (inverse Conway maneuver)[https://www.thoughtworks.com/radar/techniques/inverse-conway-maneuver], and while not easy it lets you transform your organization and system to be more efficient and effective.

## So, what to do?

As with most things in software development the answer is "it depends". There are many benefits to splitting up a system into smaller services, but there are also many benefits to keeping a system as a monolith.

My recommendation is to start out with a monolithic delivery, and keep it that way for as long as possible. This will let you focus on the business-problem you are trying to solve, and not on the technical problems of splitting up a system into smaller services.

When you have a system that is large enough that you need to split it up you will have a better understanding of the system and the domain. You will also have a better understanding of the team-topology that you need to support the system. Look at your domain and your requirements and decide on what to split out and when based on that.

You will also have a better understanding of the technical challenges of splitting up a system into smaller services once you have experience with your domain and technical requirements.

Splitting out services may be a viable way of getting away from difficult requirements, i.e. by splitting out a service that has different requirements than the rest of the system. It may also be a way of getting away from a difficult technology or deployment-environment.

When going about the actual process of splitting out smaller services - use the (strangler pattern)[https://www.redhat.com/architect/pros-and-cons-strangler-architecture-pattern]. This is a pattern that lets you gradually replace parts of a system with new parts, and it lets you keep your system running while gradually introducing smaller services from a monolith.

While you are still in the monolithic world I recommend using patterns of interaction that will make it possible to split out services later. In particular, if you are producing a service that communicates over http, use a (hypermedia)[https://en.wikipedia.org/wiki/HATEOAS] -based approach. This will let you change the implementation of the service without having to change the clients of the service. This is a powerful pattern that will let you change the implementation of a service without having to change the clients of the service.

If you are using GraphQL you can look into schema-stitching to give you the ability to gradually replace parts of your schema with new parts. This is a powerful technique that will let you change the implementation of a service without having to change the clients of the service.

The first step is often to introduce some kind of gatekeeper between your system and the outside world. Once this is in place you can let that gatekeeper route information into and out of your system, letting you change the implementation of a service without having to change the clients of the service.

If your interactions with the surrounding world are not over http you want look into using a message-bus to route messages into and out of your monolith.

## Conclusion and recommendations

Microservices are a powerful tool, but they are not a silver bullet. They can help with some issues, but they come at a high cost. With a service-based architecture you will have to deal with the issues of distributed systems and insight into what the system does becomes a lot harder to get.

First evaluate whether your organization requires and can support a move to multiple services. If you have runtime-requirements (like security, data-retention, legal or premises) that are hard to meet with a monolith - that may be a good reason to split it up.

Going into a multi-service architecture is a large change, and you will need to use tools to help you. Introduce standards around operational aspects like logging, security, monitoring, resiliency and deployment as early as possible.

I strongly recommend using a message-queue to route messages within your system, and prohibiting direct calls between services. This will let you change the implementation of a service without having to change the clients of the service. Do not EVER allow two different services to access the same database - down that path lies madness!

Treat a move from monolith to multi-service with care and respect. Realise that this is a major architectural change that will affect your system and your organization for years to come. Make sure that you have the support of the leadership and development team.

