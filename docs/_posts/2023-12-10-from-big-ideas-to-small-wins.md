---
layout: post
title: "From big ideas to small wins"
date: 2023-12-10 12:00:00 +01:00
author: "Tomas Ekeli"
permalink: 2023/12/go-small/
category: learning
tags: [learning, hackathon, needs, small]
excerpt: "From big ideas to small wins - a story about a hackathon."
main-image: "/assets/img/2023-12-10-from-big-ideas-to-small-wins.webp"
main-image-alt: "A small, red, toy car on a white background."
---

![{{ page.main-image-alt }}]({{ page.main-image }})

From big ideas to small wins - a story about a hackathon.

## Hackathing

We had a hackathon this last week, working on a real challenge that's been bugging us for a while. I was part of a team of five programmers. We spent the first day of two talking about the problem, exploring it and coming up with possible approaches. We knew we'd have a short time to make a presentation, and if possible a demo, so we had to be careful not to overreach. We had to go small.

We came up with four different approaches. I won't go into the details of the problem or solutions, but our approaches differed in complexity and scope.

First off we had an approach that boiled down to creating a new "box" that would attend to the challenge. It would solve the problem, and it had the potential to be a very powerful tool. But it would take time to build, and would lead to a new thing in our landscape that we would need to connect, support, maintain, document and monitor. It was, however, a pretty sexy solution - so it had a lot going for it.

Our second approach was extremely minimal. It amounted to adding some new things to a database, and changing around some things. It played with our existing tools, but it also risked introducing bugs in our current offering. It would mean taking advantage of some capabilities in our existing stack that we haven't yet used, but it would also mean that we'd have to be careful not to break anything. It was a very small solution, but it was also a bit risky. Being such a small solution it would also not be very impressive in a demo, it was "not the stuff of legends".

Our third approach leaned heavily on using some very hyped technology. It would let us do some very cool things that we cannot do today, and would probably give us a cool point from the marketing people. It was not technology we were familiar with, though, so we couldn't be specific on how long it would take to implement. It was also a bit risky, since we didn't know how well it would work in our environment.

Our fourth approach was a bit of a wild-card - implementing a fresh new algorithm we came up with to solve our need. The algorithm was conceptually simple, but implementing it in a way that was fast enough and actually solved our problem might get tricky. We also weren't sure that it would solve all edge-cases, so we'd have to dig deeper into it and test it thoroughly. It was a bit risky, but it was also a very small solution. It's main advantage was that it would require no new components added and could be a pure software solution.

With all these, and keeping in mind that we wanted a demo that really impressed our co-workers, we chose to go for the first solution. It was unlikely that we'd have a fully working box, but we felt we could create a prototype that proved the concept, and it could even lead to an entirely new product. It did not hurt that it was the brainchild of the most senior developer on the team! We were excited about it, and left for the day feeling good about our choice.

## Unexpected challenges

We met on the second and final day, expecting to start creating a small new service with a very limited and specific scope. We had a plan, and we were ready to go.

As they say, life happens. And this Friday had a lot of life happening - particularly with some of our customers and a gnarly database-issue that needed our best people's attention. Our group was down from five to three, and our small-scoped service suddenly seemed like a very big task. Then we got the message that our demo had been brought forward from 15:00 to 13:00. What's a few hours? Well, for us it was about a third of our remaining time. We had to rethink our approach.

We put our heads together and looked at our options. We could concede defeat and throw in the towel, or we could crunch for a few hours and see what we got to. Or, we could go for one of the other approaches we had discussed. We decided to drop our plans for a cool new service, and go for the second approach, the one that was a little bit risky and not very sexy. We had to go small.

We spent some time working on our presentation and story, as our delivery was going to be mainly the presentation. We had a few slides, and we had a demo. The code-changes were so small that they fit on a single slide. We included a sequence-diagram and explanation to explain where the new code would have to fit into our current flow. We even identified a way to make this change with a minimal impact - it would change nothing about the existing tables in our database and include just one new line of code in our server. We had a story that we could tell, and we had a solution that we could show. It was a short-story, and a small change, with an impact that solved our challenge. We had to go small, but we had something to show for it.

## The demo

In our demo we were up against all-present people, with just one team-member in the room. The other two of us were remote, cheering on and active in the chat, but not in-the-room. We presented our solution with a Miro-board presentation enriched with animations by our remote members moving things around on cue. Delightfully low-tech and home-spun, we thought, at least we'd have a chance at the "best presentation" award.

In the end we actually won the "best solution" -group by popular vote. The voting was anonymous and no reasons were given, but we won 60% of the votes. This was quite surprising to us, as we had not expected to win anything. We had to go small, but we had something to show for it.

And our hopes of winning "best presentation" - nope. We got smashed in that vote, and came in last. We had to go small, and we had something to show for it, but our presentation obviously did not win the crowd over.

## Learning

As I sit and think about it - I think we should have gone for the small solution from the start. Anything that has a minimal impact, but solves a real need is inherently preferable to something that is bigger and more involved that solves that same need. We should have gone small, but we did not until we were forced to. Losing much of our team and time brought the need into a clearer focus - and we got to deliver on something focused and small.

I hope I am wise enough to remember this lesson the next time I am faced with a challenge. I hope I am wise enough to go small.

