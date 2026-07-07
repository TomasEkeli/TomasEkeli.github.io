---
layout: post
title: "What are we even doing?"
date: 2026-07-07 21:00:00 +0200
category: architecture ai
author: Tomas Ekeli
excerpt: Software development becomes an optimisation problem over committed knowledge rather than direct editing of code.
main-image: /assets/img/2026-07-07-new-dev-cycle.webp
main-image-alt: "The tools of the trade. A book, glasses, dice and a rubber-duck."
---

![{{ page.main-image-alt }}]({{ page.main-image }})

I have been reading [Observability Engineering, 2nd edition](https://www.oreilly.com/library/view/observability-engineering-2nd/9781098179915/). A point that stays with me is that an AI-agent looking at telemetry can query anything and still "understand" nothing (if an agent can even be said to understand). The knowledge needed to interpret the signals usually lives in human heads. What the service is for, what normal looks like, why that threshold exists, what we tried last time, what tends to fail and what looks like a failure but is actually normal. Under the heading "The Agentic Incursion Has Just Begun" (ominous?) I found this section:

> Agents running in production can only be as good as the data they have access to. ... Most of all, they need us to think critically about the intuitive leaps we make and convert them into breadcrumbs of context, cardinality, and other clues.
>
> *- Observability Engineering, 2nd edition, Majors et al., 2026*

That is written about production debugging. I think converting our intuitive leaps into committed breadcrumbs has a larger impact than just that. I think it could be the way we make software and services going forward. It points out a change in what we could be committing in the future.

My hypothesis is that we are moving from code being precious to code being "regenerable". The code still exists, still runs, and we still pin and ship a specific version of it. What changes is where we invest our understanding. Instead of editing the implementation directly, we regenerate it from the artefacts above it.

Today we treat the implementation as the precious artefact, we protect it with reviews and ownership, and we treat most of the things around it as overhead. We should flip that around. Code becomes a regenerable output, and the problem, the context and the checks become the artefacts we commit and care for.

## How we have worked

We have changed how we make software many times before. We went from punch cards and assembly to compilers. These days nobody commits the generated machine code (well, almost nobody). We went from big up-front designs to agile methods that "value working software over comprehensive documentation." We learned to describe our servers in versioned text (infrastructure as code) and stopped nursing the actual machines. The running instances became disposable and the committed definition became the valuable asset. Test-driven development put some of our intent into executable checks, and continuous integration made those checks into automated gatekeepers.

I think there is a pattern to this. Whenever we get a reliable and checkable translation from a higher level of expression, the lower level stops being the thing we treasure. We stopped committing assembly when we could trust the compilers. We stopped nursing servers when we could regenerate them from definitions. We will stop committing code when we can trust the tools to generate it from our intent. The artefacts that carry our intent are the precious things, and the code becomes another transient.

## Ethics of the tools

The tools that even make this next step thinkable are the large language models (LLMs), and they come with serious ethical concerns: how they were trained, who owns and runs them, what it costs the environment to run them. And even more worrisome: what they do to us as practitioners. I have written about this in [On the Ethics of Using LLMs](/2026/07/07/on-the-ethics-of-using-LLMs.html), so I will not repeat it all here. My conclusion there was these problems spring mostly from the hyper-capitalist structure the tools (and we) exist in. I choose to use the tools deliberately within that structure. The rest of this post assumes that choice. If you are not comfortable with the use of LLMs this methodology will not fit you, and I respect that.

## A new kind of cycle

Spec-driven development (SDD) is popular at the moment: write a specification, and let a model write the code. The core of what I am describing here is SDD, specifically the variant Birgitta Böckeler [calls "spec-as-source"](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), where the spec stays primary and humans never touch the generated code. If you have used the tools in that space, like [Kiro](https://kiro.dev/), [spec-kit](https://github.com/github/spec-kit) or [Tessl](https://tessl.io/), a lot of this will look familiar.

A specification on its own is a thin slice of what we actually know when we build something, though. Böckeler is not sold on the current tools. They found the models often ignored the specs and generated duplicates anyway, and they doubt the spec really works as a source of truth today.

I think they are right to doubt it, and that is rather the point.

The parts I care about are not only in the spec. They are also the gate that decides whether the generated solution is good enough, the competing candidates we select against that same gate, and the observability loop that feeds runtime behaviour back into the input. None of the SDD tools have these, to my knowledge. If implementations are generated, what matters is what we commit as the input. There are several kinds of artefact, each carrying a different part of our understanding, giving a sort of triangulation of context to the models.

The artefacts we should commit are:

### The problem statement

The problem statement says what we are solving, for whom, what we are explicitly not solving, and which constraints are non-negotiable. This is prose, and in my experience it is the artefact most projects (surprisingly) never actually write down at all. Everything else depends on it.

### The solution space

Around the problem statement we describe what acceptable solutions look like:

- design documents that describe the intended shape of a solution, and why
- an ontology and semantic conventions, so that every artefact and every signal uses the same names for the same things
- contracts: the operations, data shapes, error taxonomies and invariants every implementation must satisfy
- architecture decision records (ADRs) that keep the decisions and the options we discarded, superseded rather than edited
- operational runbooks and requirements, the hard-won knowledge of quirks and traps
- expectations as examples: what good looks like, demonstrated rather than described
- service-level agreements (SLAs) and service-level objectives (SLOs)

### Thoughts

This may seem like a strange, new one, but hear me out. I think we should also commit the thinking: the conversations between humans and models where a design got worked out, the plans we made, the considerations we weighed. Today these evaporate in chat logs, and they hold much of what the models need to know. They are our intuitive leaps, and we can keep them as breadcrumbs of context.

The (still experimental) source-control system [DeltaDB](https://zed.dev/deltadb) seems to be moving in this direction, but if we forego the ability to move to *any* point in the work and branch off we can gain much of the power by simply committing the conversations as they happen.

Raw conversation logs are enormous, mostly dead ends, and possibly a liability: case material, secrets and personal data can all end up in them, and none of that can go into a repository. So this is not "commit the whole chat history". A better candidate is the decision reached and why, the options discarded and what ruled it out, the constraints we only found halfway through. That is close to what an ADR already captures, and maybe "thoughts" is less a new artefact than the discipline of writing that record from the conversation while the reasoning is still fresh. Someone still has to do the distilling and the pruning, and keeping the sensitive material out is part of that job.

### The gate

Getting this right will be the hardest part, and most important. The gate is a runnable fitness function that decides whether a generated candidate is admissible. It scores candidates against the contracts, the examples and the runtime requirements. It also holds instructions to a referee agent, for the qualities that are hard to express as runnable checks.

An obvious move would be to keep the gate away from the implementing models: they get the problem, the solution space and the thoughts, but not the checks they will be judged against. That helps, but it does not solve overfitting. Even if no model ever reads the gate, the loop still selects candidates by the gate's verdict, so we are optimising against the gate whether we mean to or not. [Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law) applies with no malice and at speed.

The common defence is a train/test split. Keep a set of checks the selection loop never sees, hold them back, and rotate them. Score the promoted candidate against that held-out set, and watch the gap between how it does on the checks it was selected against and how it does on the ones it was not. A widening gap implies fitting the gate rather than solving the problem. Hiding the gate would slow overfitting, but the held-out set can be used to measure it.

Don't despair if it feels like a lot of work to write the gate. All good things we humans do end up being easier if we take [many more much smaller steps](https://www.geepawhill.org/series/many-more-much-smaller-steps/). You do not need to write a perfect gate up front, you can start with a few simple checks and add more as you go. The gate is a living artefact, and it will evolve as the problem and the solution space do.

> Small, iterative, evidence-based changes.

### Implemented solutions

At the bottom we have the implementations, and these are generated. The premise is that "generation is cheap", so we can make several candidates and pit them against each other. They get evaluated by the automated gate, by the referee agent, and (if necessary) by humans. When a candidate is wrong the fix goes into the layers above, and a new candidate gets generated. A fix that only lands in the generated code will naturally be lost the next time we generate, so don't do that. The generated code is regenerable (and pinned once we promote it), and the artefacts above it are precious.

## Where the analogy breaks

There is an obvious hole in the picture I just drew. Compilers and infrastructure definitions are deterministic and complete: the same source should give the same output. This does not give us that. The gate decides whether a candidate is admissible, not that it is the only admissible one. Two runs can produce two programs that both pass and still behave differently on any input the gate never exercised. That leftover behaviour is what actually runs in production, and nothing above it pins it down.

The server analogy is perhaps clearer. We do not nurse the running instance, but we do version its definition and pin the exact image digest we ship. The generated code is that instance: we can throw it away and regenerate it, but the build we promote to production is pinned and kept until we deliberately replace it. The artefacts above stay precious, and the build we run is reproducible from them.

## This has failed before

This is not a new ambition. Literate programming, model-driven architecture (MDA) and executable specifications all tried to make our intent the source, and they all rotted. A human was still needed to translate the intent into running code. Teams ended up maintaining two artefacts that drifted apart, and the artefact that actually ran and created value won. The design document became an increasingly outdated dream that nobody bothered to update.

My hypothesis about why they failed is that the treasured artefact was never executable. A document that does nothing is a cost with little or even negative return. It was rational for teams to spend their attention on the implementation and let the document rot. And outdated and wrong documentation is *worse than none*.

Now (I hope) we may finally have the tools that do the translation themselves. This removes the second system humans had to keep in sync, and it gives the artefacts a consumer: a tireless, immediate, literal reader that uses them on every regeneration.

Things that have consumers get maintained.

I share Böckeler's concern that the current tools are not good enough yet. They are not reliable, they do not understand the artefacts, and they do not dependably generate correct code. They are, after all, inherently stochastic. Whether they will improve is almost beside the point, because by having a non-stochastic gate we can make a process that is reliable enough to be useful. The goal should be that the gate gradually accrues into a more complete and reliable check, allowing us to rely less and less on the human or agent referee.

## Continuous improvement

A system in production needs observability, we need insight into what it is actually doing. Observability is not optional. Modern telemetry is a flood of data that no human can read raw. That overload is a real problem for us humans, less so for agents.

But an agent that only sees the signals (and maybe the source-code) does not have enough context. This is where this post started. It can query anything and understand nothing. The signals have no semantic grounding of their own, and the context available to an agent is limited to whatever we thought to put into the signals.

Here the committed artefacts should help us again.

Give the agents the breadcrumbs from the other parts, the problem statement, the solution space, the runtime requirements, and give them access to the signals. Then they can correlate with the runtime behaviour of the system. They can monitor and evaluate it continuously, and they can respond to what they observe: scaling, failover, optimisation, predictive maintenance, anomaly detection.

They can suggest improvements to the solution space or the gate based on the trends they see. Those suggestions should go into the solution space or the gate, never directly into an implementation. An agent that patches the generated code is treating a regenerable output as the precious source again.

## Where this does not fit

I work on evidential software for law enforcement, so I have to ask the question my colleagues would ask first: what happens to chain of custody when the code is generated and regenerated? Every regeneration is fresh code. It has to clear security review again, and the measured vulnerability rates for generated code are not reassuring (a [2025 Veracode GenAI Security Report (PDF)](https://www.veracode.com/wp-content/uploads/October-2025-GenAI-Code-Security-Report-Update.pdf) found common web vulnerabilities in 45% of the samples it tested). It also has to be defensible where it counts, and "a model wrote it, and we did not keep which model or which version" is a poor answer in a courtroom.

This is not fatal. Model-driven generation has a long track record in safety-critical work, where every regeneration is audited and the inputs are pinned. But generated code is harder to justify in regulated and evidential domains than in, say, a feed aggregator. The honest position is that this way of working fits best where a wrong candidate is cheap to catch and a regeneration is cheap to run. It has to earn its way into the places where a mistake ends up in front of a judge.

There are different kinds of software, and the methodology for producing medical equipment is not the same as for a social media feed. I would need to see this prove itself in a domain where the stakes are low before I would even consider it in my work. What I need is a trial.

## A candidate trial

I have not tried any of this, so it remains a hypothesis - a thought-experiment. To test it I want a problem that is small and testable.

In the trial I would generate multiple solutions to the problem, rank them and promote the best, and then evaluate.

- Do the candidates pass the gate, and does the gate catch the ones that should fail?
- Do the candidates hold up to human eyes, would we be willing to run them?
- Does the improvement cycle work? When an upstream dependency changes, does the loop regenerate a working component without me repairing anything by hand?
- What does the cycle cost, and is it viable? If not, why not, and what would have to change? Is it viable for some problems, or under some constraints? Is it trending towards viability, or away from it?

The cost question may be the most important one, this way of working only makes sense if the cycle is cheap enough to run routinely.

### What it could look like

Imagine this:

```
Problem:
    Shorten long URLs and redirect to them.

Solution space:
    REST API.
    Immutable storage.
    OpenAPI contract.
    ADR explaining why.

Gate:
    API tests.
    Performance.
    Security.
    Property tests.

Generated:
    Five implementations.

Result:
    Candidate #3 wins.
```

## Conclusion

If this holds up, the artefacts humans make will move away from code. The problem, the context and the gate become the precious things, and the code itself becomes a regenerable output, pinned once we ship it but never the source of our understanding.

We can iterate rapidly on solutions, pit them against each other, and let the gate (and human judgement) pick the winners. The context we commit helps the tools understand the runtime behaviour of our systems, and it helps us understand what the tools suggest back to us.

All of this is a hypothesis. To test it we have to try it, and see whether it is viable, and for which kinds of problems. If it works we may have a new way of making software.
