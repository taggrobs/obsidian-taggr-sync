# What is Taggr?

A short, plain-English guide for people who've never heard of it — or who've heard of it but bounced off the crypto-adjacent vibe and want to understand what's actually going on.

This is written by someone who started out as a user, not a founder. I'm building an Obsidian plugin on top of Taggr because I think it's the most interesting publishing platform I've seen in years, and I want to explain it the way I wish someone had explained it to me.

## The one-sentence version

**Taggr is a social platform where people write, discuss, and tip each other — but every post, comment, and reaction lives on a blockchain, so no single company, government, or platform owner can take your writing down.**

That's it. Everything else is a consequence of that one design decision.

## The one-paragraph version

Imagine Reddit, but instead of Reddit the company owning the servers, the posts, the moderation rules, and the revenue, all of those things live in a smart contract on the Internet Computer blockchain. Users pay a tiny amount to post (less than a cent for most posts). Other users react to posts with emoji, and each reaction moves a few reward points from the reader to the writer. Every week, those reward points are converted into ICP — the Internet Computer's native token — and distributed to the people who wrote good things. If you want to run a community (a "realm") on top of Taggr, you can, with your own moderation rules, and you keep a share of the activity happening in your realm. If you don't like how one frontend operator is filtering content, you use a different frontend — they all read from the same underlying canister. No one can delete you. No one can monetize your content behind your back. That's Taggr.

## What problem does Taggr actually solve?

Every platform writers use today has the same structural problem: **the platform owns the relationship with your audience**, not you.

- You write on Medium. Medium changes the monetization rules. Your income drops. You have no recourse.
- You post on Twitter. Twitter shadowbans you. Your reach collapses. You have no recourse.
- You publish on Substack. Substack decides a topic is off-brand. You're deplatformed. You have no recourse.
- You publish on your own Ghost blog. Your hosting bill goes up. You forget to renew your domain. Your writing vanishes.

Even "decentralized" alternatives usually just move the problem somewhere else: a relay operator, a federated instance admin, a foundation. Someone still has the kill switch.

Taggr's pitch is blunt: put everything — the posts, the social graph, the moderation rules, the revenue flows — inside a smart contract that no single party can turn off. Then build a normal-looking social platform on top of that contract. Users should barely notice it's on a blockchain; the blockchain is just the reason the platform can't betray them.

## The core concepts

You only need to understand five things to use Taggr competently.

### 1. The canister

In Internet Computer language, a "canister" is a smart contract — but a supercharged one. It can store files, serve web pages, handle HTTP requests, and run arbitrary code. Taggr is one big canister (plus some helpers) that holds every post, every user account, every comment, every reaction, every realm, and serves the entire frontend to your browser.

That last part is worth dwelling on. When you visit a Taggr domain, you are not hitting a normal web server. Your browser is loading the Taggr app directly from the blockchain. There is no AWS instance in the middle. There is no company's data center. The canister runs as long as the community keeps it funded with compute cycles, and nobody has the keys to shut it down.

### 2. Credits

To do almost anything on Taggr — post, comment, react — you spend a small amount of "credits." Credits are purchased with ICP or Bitcoin, and a beginner bundle is worth roughly **one US dollar** at current rates.

Prices are measured in such small units that most actions feel free:

- Posting a short note: fractions of a cent.
- Reacting to someone's post with an emoji: also fractions of a cent, but that tiny amount moves to the author as a reward.
- Posting an image: a bit more, based on the image size.
- Editing a post: cheaper than posting a new one.

Why charge at all? Because every post and reaction has to be stored in the canister forever, and storage on a blockchain isn't free. Charging a tiny fee does two things at once: it covers the real infrastructure cost, and it prices out spam. You can't flood Taggr with bot posts because you'd run out of credits in a few minutes.

### 3. Rewards and ICP

Every reaction on your content shifts a few reward points from the reacting user to you. Once a week (on Fridays), Taggr sweeps up everyone's accumulated reward points and converts them into ICP — real, liquid cryptocurrency — distributed proportionally to the writers.

If you write things people find useful, you earn. You don't need a subscription. You don't need ads. You don't need to sell a course. You just write, and the people who read you vote with a fraction of a cent every time they tap a 🔥 or a 🤯 on your post.

This is not get-rich-quick. For most writers, it's a few dollars to a few dozen dollars a week at current platform scale, in line with what a small Substack with genuine readers might pay. But the ratio of effort to reward is meaningfully better than most platforms, and the downside is capped: you spend cents to publish, so you can't lose money.

### 4. Realms

A realm is a sub-community inside Taggr, built around a topic. Think "a subreddit, but where the moderators are chosen by the community, and where the moderators can optionally share in the revenue their realm generates."

Every post on Taggr lives either in the general feed or inside a specific realm. Realms have their own controllers (moderators), their own rules, and often their own vibe. You can post the same thing into `#crypto` and into `#writing` and see completely different comment sections — that's the point.

If you run a realm, you set the posting rules and the moderation bar. Some realms share a percentage of the activity revenue with their controller, so running a good community isn't just altruism — it can be a small-to-medium income stream.

### 5. Domains (this is the interesting one)

Here's the part that nobody talks about and that changes how you should think about "decentralized platforms."

On most platforms, including most decentralized ones, there is exactly one version of the frontend. Everyone sees the same thing, filtered by the same rules. Taggr is different: the canister serves **the same underlying content to many independent domains**, and each domain operator gets to configure, for their own domain, which realms to show, which to hide, which to require content warnings for, and so on.

In practical terms: someone in Germany might run a Taggr domain that blocks realms that violate German law. Someone else might run a domain that leans into adult content. Someone else runs one that whitelists only a handful of high-quality literary realms. All of these domains read from the same canister. Your post can be visible on some domains and invisible on others, depending on what each operator decided.

This is important for two reasons. First, it means content moderation is not a single-party decision — you can never be "banned from Taggr," only filtered out by specific frontends, and anyone can spin up a new domain that does things differently. Second, it means operators bear the local-law risk for their own users, the way restaurant owners are responsible for what they serve in their restaurant, not the farm that grew the vegetables.

If you come from a free-speech-maximalist angle, this lets you always find a domain that shows you everything. If you come from a content-moderation angle, this lets you run a corner of Taggr with the rules you want. Both can exist at once.

## Who's running the place?

Nobody, in the traditional sense. Taggr was started by a small team (publicly credited in the whitepaper), but operational decisions — which features ship, which policies hold, how much revenue each category of contributor earns — are governed on-chain. The founder has a time-locked allocation in the governance token, but every meaningful change requires broader support.

Day-to-day moderation is handled by "stalwarts" — a rotating group of long-term, active, high-reputation users who are automatically selected as moderators based on their track record. There is no hiring process. You don't apply. You just use Taggr responsibly for a long time, and eventually the rules promote you into the role.

Paid employees? None that the whitepaper mentions. The platform is almost entirely community-run, with its economic engine coming from credit purchases (the "entry fee") and reward distributions (the "paycheck").

## How do I actually use it?

Three paths, depending on how comfortable you are with the underlying plumbing.

**The easiest way.** Go to [obsidian.taggr.social](https://obsidian.taggr.social) (if you're an Obsidian user) or [taggr.link](https://taggr.link) (the canonical frontend) and sign up. You get an account, a seed phrase (write it down), and a small starter balance of credits. Start posting. React to people. Read what's in the feeds. That's it; you're using a blockchain and you don't need to know any of the mechanics.

**The power user way.** Once you have an account, you can join or follow specific realms, tip other users in ICP, run your own realm, participate in governance votes, or contribute code to Taggr itself (it's open source).

**The writer way (this is what I built the plugin for).** If you already write in Obsidian — because you want local files, backlinks, and no lock-in — you can install the Taggr Sync plugin for Obsidian. Then your vault *is* your Taggr account. Write in Obsidian the way you always did, push, and every note you choose to publish lands on Taggr. Pull, and every post from your Taggr account comes back into your vault. The markdown stays markdown, the backlinks stay backlinks, and you get a real audience without ever leaving the editor you already use.

## Honest limitations

I'm building on Taggr because I think it's good, not because I think it's finished.

- **It's small.** The user base is a few thousand active people, not millions. If you expect instant discovery of your writing by a huge audience, you'll be disappointed. If you're okay being early, this is what early looks like.
- **The UI has rough edges.** The web app is built by engineers and looks like it. This is improving, but if you're used to the polish of Notion or Substack, adjust expectations.
- **Onboarding asks more than a normal social app does.** You have to buy a small amount of credits to post, and you have to hold onto a seed phrase. Taggr's team is actively working on smoother onboarding paths.
- **The ecosystem around it is still maturing.** Tools, integrations, and discovery surfaces are being built right now — including, honestly, the Obsidian plugin I'm writing this from. If you want the polished late-stage product, wait a year. If you want to shape what a great platform looks like, show up now.
- **It is adjacent to crypto, and some of the adjacent conversation is noisy.** Taggr does have a governance token, the token has a price, and some people are there to speculate on the price. You can ignore all of that entirely and just use Taggr as a writing platform. The things I described above — credits, rewards in ICP, realms, domains, stalwarts — are what matter day to day.

## Why I think this matters

I've watched too many writing platforms rise, betray their users, and fall. I've paid for three different self-hosted blogs and let all three lapse. I've had tweets disappear and newsletters land in spam. I've helped friends migrate their audiences across four platforms in five years.

Every single time, the underlying problem was the same: **the writing and the platform were controlled by different people, and those people's interests eventually diverged from mine.**

Taggr is the first platform I've used where that divergence is structurally impossible. The content lives on the chain. The rules live on the chain. The revenue flows live on the chain. A frontend operator can choose not to show you, but they can't take you down. A founder can try to change the rules, but they can't do it alone. And because the whole system is open source, anyone who doesn't like the direction can fork it and run their own canister.

That's not a utopia. Decentralized systems have their own failure modes — slow decisions, coordination problems, early-stage roughness. But for the specific problem of "I want to write for a living and not be at the mercy of a platform that can turn on me," Taggr is the closest I've seen to an actual answer.

If you're a writer who's been burned by platforms before — come take a look. Start small. Write a single post. See how it feels. You can leave whenever you want, and unlike every other platform you've tried, your writing comes with you when you go.

---

*This is a community explainer, not an official Taggr document. For the canonical technical description, see the [Taggr whitepaper](https://taggr.link/whitepaper). For the Obsidian plugin I'm building on top of all of this, see the README in this repository.*
