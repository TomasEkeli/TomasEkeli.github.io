---
layout: post
title: "Merging aggregates"
date: 2023-05-23 12:00:00 +01:00
author: "Tomas Ekeli"
permalink: 2023/05/merging-aggregates/
categories: [ddd, cqrs, event-sourcing, development, documentation]
---

![Merging roots](/assets/img/2023-05-23-merging-aggregates.png)

As we learn and evolve our system we sometimes need to move the responsibilities of one aggregate-root into another.

This article explains how to do that in a consistent, event-sourced manner.

There is a [GitHub repository](https://github.com/dolittle-entropy/aggregate_merging) with the code for the merger described in the article – the main branch is before the merger – the article branch is after with an early draft of this article.

## Summary

By explicitly retiring an aggregate-root and storing its state when retiring we can seamlessly assume its responsibilities in another aggregate-root. This is done by making the change explicitly with events.

## Aggregate-roots protect the data-invariant

[Aggregates](https://www.martinfowler.com/bliki/DDD_Aggregate.html) are clusters of objects that change together. To make sure they only change in acceptable ways we control access to this aggregate through and aggregate-root. This aggregate-root is the only way things outside the aggregate get to interact with things inside the aggregate.

In a system that uses the aggregate-root -pattern there are entities in our domain that protect the “[data-invariant](https://en.wikipedia.org/wiki/Invariant_(mathematics)#Invariants_in_computer_science)“. These aggregate-roots (sometimes just called aggregates, as they represent the entire aggregate to the surroundings) are the single points of access. All changes to the system happens through them.

The aggregate is the gate-keeper, it verifies that the changes to the system are valid and legal. The aggregate-root protects the data-invariant. By this I mean that the aggregate makes sure the system cannot end up in an invalid state, by applying its business rules and rejecting invalid calls.

## All state changes are events

Some systems store state directly, others are event-sourced. The difference is that event-sourced systems store changes as a sequence of events, instead of storing the “current state” as a snapshot.

With the [Dolittle SDK](https://dolittle.io/) you can create an event-sourced system. Our aggregate-roots get their internal state from a stream of events. In an aggregate-based system all the changes that affect an aggregate-root must also come from that aggregate. Otherwise the aggregate would not be able to protect its invariant.

The aggregate-root is therefore the source of events that modify state, and it protects the data-invariant before emitting events that change it this state. The aggregate-root is the event-source and the final arbiter of whether something can happen.

This means that when change should happen in the system it must go through an aggregate. For this aggregate to protect the data-invariant it needs to know the current state of the system. Aggregate-roots from the Dolittle SDK get to know their current state by running through all the events that they have emitted. These events set its internal state.

After such a run-through the internal state of the aggregate is the true state of the system. The aggregate is its own microcosm and can fully protect its internal consistency.

For this reason an aggregate-root is a good candidate for a micro-service, if you need to separate your system into services.

## Things change

Software development is the process of learning and change. We discover new things about our system. Often things that seemed evident turn out to be wrong, or to change over time. This is _normal_ and a _good thing_ – we should discover new things and learn about our system. The system can and should change.

We need the ability to adapt even the most basic parts of our system, like how we protect the data-invariant. We might have gotten the data-invariant wrong. Or we might have been correct but we discover that we no longer are.

## Example: an ordering system

Let us consider a system for ordering products. We have two aggregate-roots.

One is the customer _\-aggregate-root,_ which handles the creation and removal of customers. It has the invariant that a customer must be in a non-created state to be created and must be created in order to be removed.

The other, order _\-aggregate-root_ is more complex. An order must be created before it can be abandoned, placed or have items added to it. It must have an item added to it before that item can be removed. It must have something on it and not be abandoned in order to be placed, and no items can be added or removed on it after it is placed or abandoned.

### New needs

We discover two new needs: orders should always belong to a customer that exists. And a customer should not have two placeable orders at the same time. Remember that a placeable order is one that exists, is not abandoned and has items on it.

We can not protect this data-invariant with the order -aggregate-root. It has no concept of the customer, outside of an id that happens to go on the order. It does not know if that customer exists or not. Further, as each instance of the order _\-aggregate-root_ is distinct it knows nothing about any other orders. Therefore an order cannot check whether a customer has other orders she can place.

### Moving responsibility

We must change the system by moving the orders onto the customer _\-aggregate-root_. When the customer _\-aggregate-root_ manages the orders it can make sure that an order belongs to a customer. In fact – creating an order without a customer becomes impossible. This new aggregate-root can also make sure that a customer has only one active order at the same time.

It is easy to move the functionality of the order into the customer. Perhaps we make the current order -aggregate-root into an internal object within the customer -aggregate-root, and route all changes to the order through the customer. The order is no longer an aggregate-root and is inaccessible from the outside. We put the order into the aggregate that the customer controls.

This allows the customer-aggregate-root to protect the full data-invariant. All existing validation on the order keeps working as the customer -aggregate-root delegates to the order. The customer aggregate-root grows, but it gains abilities by delegating to the order.

### Dealing with existing orders

There is a problem, however: there are already orders in the system created by the old order-aggregate-root. These orders exist as events on the old order order aggregate-roots’ streams. These events will therefore _not_ replay when the customer -aggregate-root (that has assumed control of the order) gets rehydrated! This is because those events did not originally come from the customer -aggregate-root. Thus the system believes they should have no effect on its internal state.

To protect the invariant on existing orders we need some way of getting the data from the old events in the order -aggregate-root’s stream into the customer -aggregate-root.

To transfer responsibility between the aggregate-roots we can make the transfer into explicit as events in the system. _Remember that in an event-based system all state-changes happen through events._

By modelling our merger of aggregate-roots as events in the system we give the system the ability to react to this change.

Let us make two new events to support this transition: an event from the _order_ \-aggregate-root announcing that it has retired (relinquished responsibility), and an event from the _customer_ \-aggregate-root marking that it has assumed the responsibility.

We give the order -aggregate-root a new method, `.Retire()` which summarizes its internal state and applies that as the “I have retired” -event. Next we give the customer -aggregate-root a new method, `.AssumeOrderResponsibilityFor(orderId, {state})` which accepts the state of the order as arguments, and applies that as the “I have assumed responsibility for this order” -event.

When the customer -aggregate-root rehydrates and gets one of these “assume responsibility” -events it sets the state of that order in it’s internals.

If effect we are transferring the state of the old order into the state of the expanded customer.

### Actually transferring the responsibility

This gives the order- and customer -aggregate-roots the ability to transfer responsibility. Now we need to actually transfer the data.

Let me introduce another concept – the reaction. A reaction (I’ve also seen them called a Policy) is an event-handler that does something. We could say that all event-handlers are reactions, but I call them out specifically because they are intended to cause new events based on events. This is fraught with danger, and if you are not careful you can get cascades of events. Use these sparingly.

We make a reaction in our system that handles the existing order-created event by telling that order -aggregate-root to retire. If we need a staged-rollout this is where you do it (i.e. only retire for certain customers, to verify that everything works. This causes the order -aggregate-roots to retire and emit their state as an event.

Finally we make a reaction to this “retired” -event. We get the correct customer -aggregate-root (this id should be on the order-state, see below) and tell it to assume responsibility for the order. As the “retired” -event contains the whole internal state of the order -aggregate-root when it retired we have all the data to give to the customer -aggregate-root.

Note that the reaction does not emit any events, it calls on aggregate-roots who in their turn emit the events.

We end up with a remnant of the order -aggregate-root which only contains the `.Retire()` -method and its internal handling to set state. The customer-aggregate-root expands to cover everything an order could on its order(s). It can also assume responsibility for retiring order-aggregate-roots.

Once all the order -aggregate-roots have retired the order -aggregate-root -class can go away. We can also remove the method to assume responsibility on the customer -aggregate-root.

### My old aggregate didn’t have the state to move to my new aggregate

You might be moving from one aggregate-root to another which you do not know the id of. In our example that would mean that the order -aggregate-root did not store the customer-id in its internal state. Sometimes you will have that information on the stored events that replay, and you can simply add it to the internal state of your aggregate-root and make it part of the state it leaves behind when retiring.

If this is not possible you might need to look it up in the reaction – using data from the state of the retiring aggregate-root to look up other information in the system. This is more fragile, as the state you send into the aggregate that assumes responsibility will depend on the state of the system when you run the transition.

### Final state

We now have a system with only one aggregate-root – the customer. The customer has all the information it needs to protect the data-invariant, and no data about old orders was lost.

One problem: the existing system may be in a state inconsistent with the defined data-invariant. In other words, we may have orders without customers, or customers with many placeable orders. This is likely the reason we introduced these new business-rules, after all.

It is up to us to now decide how to handle these inconsistencies.

Compensating transactions will be your friend here, but that is a topic for another time.