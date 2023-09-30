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

Much has been written about [microservices](https://en.wikipedia.org/wiki/Microservices) as an architectural pattern. I have worked with them for many years, and have thoughts on when they make sense and the consequences of using them.

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
Usually a monolith is a single tech-stack, as in all the code is in the same language and uses the same libraries. This can make it easier to for people to "move around" in the system. If everyone knows Java and everything is Java they can work on everything.

### Easier to debug
When you detect an error you have one solution to blame and to trace the error to. This is often overlooked as a benefit, but it is a big one. The ability to trace a logged error to a single line of code and be sure that it is the only place where the error comes from is a huge boon.

### Faster to run
Since everything usually runs in one (logical) process with a monolith they are also quicker to run a process through. Any multi-service architecture will have some overhead in communication between the services. This will slow down the entire system.

### Less code
In a multi-service architecture you must create logic around the interactions between services. Handling timeouts, down-time, errors, retries, etc. is difficult code to get right. This is code that you will have to write and maintain, and it does not add direct value to the business.

If you are not careful and use patterns like [circuit-breakers](https://martinfowler.com/bliki/CircuitBreaker.html) and [event-driven architectures](https://martinfowler.com/articles/201701-event-driven.html) your system will, at best, be as resilient and reliable as the least reliable service in your system.

### Easier to deploy
A monolith is a single deployable unit, and as such is usually easier to deploy than a set of services. You deploy the entire system at once, and you can be sure that the entire system acts as a unit. You can also be sure that the entire system is running the same version of the code.

## Why split up?

We know that people are bad at creating, understanding, maintaining and changing large systems. Smaller services respect this premise. If creating large systems is hard - let's create smaller systems.

Splitting up to smaller services carries with it a whole host of benefits:

### Fewer spooky bugs at a distance
Working in a monolith is scary. Changes to one part of the system cause strange bugs in seemingly unrelated parts of the monolith. This is because the entire system is running in the same process, and a bug in one part of the system may affect another part of the system. In fact these parts are not separate at all, they *are the same system*.

Shared global writeable state and unclear patterns of interaction between the different parts of the system are usually the culprits here. Enforcing interfaces between the services and not sharing state make these kinds of bugs are a lot less likely to occur. An effective way of enforcing interfaces and making shared state unlikely is to have the parts run as separate processes, that is as services.

### Scale
A monolith is a single deployable unit, and it is usually deployed as a single process. This means that you cannot scale parts of the system independently. If you have a part of the system that is used more than the rest of the system you will have to scale the entire system to handle load.

When you need to scale a monolith you will have to scale the *entire* system, even if only a small part of it is under load.

### Independent development
If you have a large system with many teams working on it you want those teams to work independently. With a monolith you run the risk of different teams stepping on each other's toes. You can mitigate this with all sorts of rituals and procedure, but it is not easy. You will find that your architecture does not help you.

With separate services your developers can work without worrying about stepping on each other. There are fewer merge-conflicts and development-flow for each service becomes smoother.

*This does not mean that the developers no longer need to communicate!* Just that their work in one service is unlikely to affect others' code directly. It still requires that everyone adheres to the defined interfaces and service-level agreements between the services.

### Independent deployment
If you have a large system with many teams working you want to make sure that the teams can deploy their changes independently. Instead of defining [release trains](https://en.wikipedia.org/wiki/Software_release_train) and having to coordinate deployment of the entire system you can deploy each service at its own cadence. Splitting into services  gives you the ability to deploy changes to parts of the system, while it is under load.

To be able to deploy independently you need to have a mature dev-ops organization and and deal with several versions of the same service running at the same time. [Blue/Green deployments](https://martinfowler.com/bliki/BlueGreenDeployment.html) and [canary deployments](https://martinfowler.com/bliki/CanaryRelease.html) are techniques that can help with this.

### Independent technology
Developers have different skills and interests. To attract and keep people on your team it may be important to be flexible in your tech-stack. Some domains are better suited to particular technologies. In a monolith all teams must work with the same technologies, regardless of interests or domains.

By splitting up the system into smaller services each team can gain some leeway in choosing their stack. This means that you can have a team working with Java, another with C#, and yet another with Python and one with PHP. The choice of technology becomes another dimension you can vary. You can also have services that use latest version of a technology, side by side with an services on older versions.

A point of caution here: do not use *too* many different technologies in your system. I recommend having small set of technologies that you can support and maintain. Remember that your organization will probably have to support the deliveries for some time.

This also gives a smaller set of technologies that you need to hire for, and make it more likely that you can find internal developers with the necessary skill-set. If you have too many technologies you may be stuck with services that nobody can work on. You may even be forced to re-write them in a different technology just because you have lost the ability to support the existing technology.

### Independent data
A service with its own data-storage is a natural boundary for data. With a monolith you the entire system must adhere to the strictest requirements. With separate services you can have different services adhere to different requirements.

You gain control over which data resides where, and can separate by requirements. This means that you can have services that may store financial or personal data, and services that may not. You can separate data-storage by regions for different services. Some services can to store data on-premises, while guaranteeing that some are off-premises.

### Independent scaling
If you have a separate services you can scale parts of the system independently. With a monolith you need to scale the entire system, even if only a small part of it is under load. In my experience such monolithic systems sometimes even need to be single instances. Scaling such systems is nigh impossible.

With separate services you scale the services under load without having to scale the entire system. Conversely you can also restrict services that are particularly expensive or resource-hungry if needed. You gain flexibility in how you use your resources that a monolith cannot provide.

### Independent failure
In a monolith a failure often means that the entire process is lost. With separate services and message-based communication the failure of one service may not mean that the entire process is lost. You can use recovery-patterns that let you recover from failures in any single service, and save the process as a whole.

With separate services the developers will discover the need to handle failing services. This is a pain we quickly encounter, but it is actually a *good thing*. This forces us to treat all our services as unreliable, and handle that.

This means that we learn to handle services that are down, or slow, or that return errors. Done right (which is non-trivial) this gives your system as a whole resilience and reliability that a monolith would struggle to provide. Monoliths rarely handle failure well, as their entire context is lost when a process fails.

### Differing runtime considerations
It is common to have different requirements for different parts of your system. You may need to run certain parts in a certain region, or on-premises, or in a certain cloud. Perhaps you have different requirements for security, or for data-retention, or for performance. With a monolith your system must adheres to the strictest requirements. With separate services you can have different services adhere to different requirements.

### Easier to understand
As your system grows and evolves it takes on new responsibilities and new features and new developers. Over time it tends to grow harder to understand, and harder to change. By splitting up the system into smaller, simpler services we can ensure that each service is more understandable. Our goal is that each service is small enough to fit in the head of a single person, which is obviously not possible with a large monolith.

### Repleaceability
With a system of services that interact in well-known and well-defined ways you can replace parts of that system. And, you can do so while keeping the rest of the system intact. This means that you can replace a service with a new implementation or a third-party service.

This requires that you have well-defined interfaces and protocols of interaction. You also need some way of routing information between your services. This routing system then gives you the ability to replace a service with another.

When introducing smaller services we use the [strangler pattern](https://www.redhat.com/architect/pros-and-cons-strangler-architecture-pattern). It is a powerful pattern that lets you gradually replace parts of a system with new parts. Even after you've moved to separate services you will use your data-routing -system to route information to the new service instead of the old one.

### Team topology
This is a bit of a meta-reason, but it is an important one. By splitting up your team into smaller teams also split system into smaller services. You can use your team-structure as a blueprint for your system architecture. In fact, your system architecture cannot help but reflect your team structure.

Separating services from a monolith is done by setting up teams that reflect the services you want. This is a good thing, but it is also a hard thing. It is hard to know what the right team-topology is, and it may become hard to change the team-topology once it is set up. You may also need to set up supporting teams, for larger organizations.

Setting up different teams and deciding how to split up the system is the job of the "architects" and technical leaders. They work together to transform the organization while keeping the system running.

This exercise is what is sometimes referred to as the [inverse Conway maneuver](https://www.thoughtworks.com/radar/techniques/inverse-conway-maneuver). It is a technique to transform your organization and system towards some goal.

## So, what to do?
As with most things in software development the answer is "it depends". There are benefits to splitting up a system into smaller services, but also to keeping a system as a monolith.

My recommendation is to start out with a monolithic delivery, and keep it that way for as long as possible. This will let you focus on the business-problem you are trying to solve. Spend less time on the technical problems of splitting up a system into smaller services.

When you have need that that leads you to split it up you will should have an understanding of the system and the domain. You will also need to understand the team-topology that you need to support the system. What changes do you need to initiate within the team-structure?

 Look at your domain and your requirements and decide on what to split out and when based on that. Maybe budding off just a few services is enough?

You will also need to understand the technical challenges of splitting up a system into smaller services. You will spend time on deployment pipelines, integrations and testing constellations of services.

Splitting out services may be a viable way of getting away from difficult requirements. Split out services that have different requirements than the rest of the system. This is also a way of getting away from a difficult technology or deployment-environment.

When splitting out smaller services - use the [strangler pattern](https://www.redhat.com/architect/pros-and-cons-strangler-architecture-pattern). This lets you replace parts of a system with new parts, while it keeps running.

### Not yet, but maybe soon?
If  you are still in a monolith: consider patterns of interaction that will make it possible to split out services later.

In particular, if you are producing a service that communicates over http, use a [hypermedia](https://en.wikipedia.org/wiki/HATEOAS) -based approach. This lets you change the implementation without having affecting clients of the service.

If you are using GraphQL: look into schema-stitching to give you the ability to gradually replace parts. This is a powerful technique that will let you change the implementation. Keep your clients working while changing the system!

If none of these techniques fit you need a gatekeeper. Once that is in place you use it to route information into and out of your system. This lets you change the implementation of a service, again without having to change the clients of the service.

If your interactions with the surrounding world are not over http you want look into using a message-bus to route messages into and out of your monolith.

## Conclusion and recommendations

Microservices are a powerful architectural pattern, but they are not a silver bullet. They can help with some issues, but they come at a high cost. With a service-based architecture you will have to deal with the issues of distributed systems. Insight into what the system does becomes a lot harder to gain.

First evaluate whether your organization requires and can support a move to separate services. If you have runtime-requirements (like security, data-retention, legal or premises) that are hard to meet with a monolith - that may be a good reason to split it up.

Going into a multi-service architecture is a large change, and you will need to use tools to help you. Introduce standards around operational aspects like logging, security, monitoring, resiliency and deployment as early as possible. Use [open-telemetry](https://opentelemetry.io/docs/what-is-opentelemetry/), and trace processes across services. Think about how you will handle a potentially large set of services - do you need a developer portal? How will you handle service-discovery? How will you make sure all the services conform to your standards?

I strongly recommend using a message-queue to route messages within your system, and prohibiting direct calls between services. This will let you change the implementation of a service without having to change the clients of the service. It also lets you pick up failing processes and save data. Do not EVER allow two different services to access the same database - down that path lies madness!

Be sure to treat a move from monolith to multi-service with care and respect. This is a major architectural change that will affect your system and your organization for years to come. Make sure that you have the support of the leadership and development team.
