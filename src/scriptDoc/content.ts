/**
 * Final Expense script v4 + objection rebuttals + emotional triggers, cleaned
 * up from "All Policy Printer Scripts.pdf". Inline markup: see ./types.ts.
 */

import type {DocNode} from './types';

export const DOC_TITLE = 'Final Expense Full Script';
export const DOC_SUBTITLE = 'v4 — Sectioned with DQ branching + benefit callbacks';

export const SCRIPT_DOC: DocNode[] = [
	// ───────────────────────────── SCRIPT ─────────────────────────────
	{
		id: 'intro',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 1',
		title: 'Intro',
		blocks: [
			{t: 'h', text: 'Opening'},
			{t: 'say', text: 'Hi. Are you calling to qualify for an affordable funeral coverage plan today?'},
			{t: 'note', text: 'Wait for confirmation.'},
			{t: 'say', text: 'Ok perfect, my name is {{your name}}. I’m the Benefits Coordinator for the state of {{state}}.'},
			{t: 'say', text: 'My job is to simply explain these plans to you, answer any questions you have about the coverage, and help you find the most affordable option as well.'},
			{t: 'say', text: 'For compliance purposes, may I ask who I am speaking with?'},
			{t: 'choices', prompt: 'Caller opens with…', options: [
				{label: '“I thought it was free”', to: 'obj-free'},
				{label: '“I want to claim the $25k / $40k”', to: 'obj-claim-25k'},
				{label: '“I have questions about my existing policy”', to: 'obj-existing-policy'}
			]},
			{t: 'h', text: 'Incentive-Based Discounts', id: 'intro-discounts'},
			{t: 'say', text: 'The good news is there may be a few discounts available to help you more. So, I’m going to see which ones you may qualify for today.'},
			{t: 'list', ordered: true, items: [
				'Are you currently over the age of 50? **(YES)**',
				'Are you a smoker or non-smoker? **(YES)**',
				'Are you receiving Social Security, Disability, or VA benefits? **(YES)**',
				'When you receive those benefits, do you normally use a traditional bank, a credit union, or a Direct Express card?'
			]},
			{t: 'say', text: 'Perfect. In that case, you **DO** qualify for the discounts, so I’ll go ahead and apply for them for you now.'}
		]
	},
	{
		id: 'dq',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 2',
		title: 'Discovery Questions',
		short: 'Discovery (DQ)',
		blocks: [
			{t: 'h', text: 'Motivation + Situation', id: 'dq-motivation'},
			{t: 'inst', title: 'Motivation first, then situation', body: [
				'Get the big **WHY** they called in today, then learn their situation. Ask these **before** explaining the coverage. Slow down and let them talk — their answers are what you’ll call back during the [Pitch](#pitch).'
			]},
			{t: 'say', text: 'Is this your first time looking into these plans?'},
			{t: 'say', text: 'Okay, so just to confirm — you don’t have any plans to cover your final expenses yet?'},
			{t: 'choices', prompt: 'Which branch are they on?', options: [
				{label: 'Shopped before, still uncovered', to: 'dq-b1'},
				{label: 'First time, no coverage', to: 'dq-b2'},
				{label: 'Already has some coverage', to: 'dq-b3'}
			]},
			{t: 'path', id: 'dq-b1', label: 'Branch 1 — NO on first-time + YES on no coverage', blocks: [
				{t: 'note', text: 'They’ve shopped before but are still uncovered. Get the big WHY, then their situation.'},
				{t: 'say', text: 'Oh wow… What made you decide not to get Final Expense from the previous agents you spoke with? Was it because of the experience, the pricing, did you get knocked out for health issues, or was it something else?'},
				{t: 'note', text: 'This shows you what to improve on so you don’t repeat the previous agent’s mistakes. More DQs: [Emotional Triggers](#triggers).'}
			]},
			{t: 'path', id: 'dq-b2', label: 'Branch 2 — YES on first-time + YES on no coverage', blocks: [
				{t: 'inst', title: 'Re-loop rule', body: [
					'If they give a cost answer — they thought it was **free**, or they mention the **$25k / $40k** — re-loop once:',
					'“Okay, but if you really think about it — besides thinking it was free or seeing the $25k or $40k — was there another reason?”',
					'Only re-loop on those two. Handle it before moving on: [Free objection](#obj-free) · [$25k / $40k objection](#obj-claim-25k).'
				]},
				{t: 'say', text: 'Oh, I see — then what made you feel like calling in and wanting more info about this coverage?'}
			]},
			{t: 'path', id: 'dq-b3', label: 'Branch 3 — NO on the confirm question (has coverage)', blocks: [
				{t: 'say', text: 'Oh, I see — so what made you call in today to get more info on this coverage?'},
				{t: 'note', text: 'If they push back with “I already have insurance” → [Already Have Insurance](#obj-have-insurance).'}
			]},
			{t: 'inst', title: 'More samples', body: [
				'**Situation:** “Just so I get a clear picture — do you have any coverage in place right now, or would this be the first policy protecting the family?”',
				'**Motivation:** “And what’s got you looking into this now? Was it something that happened recently, or are you just wanting to get ahead of it before it becomes a problem?”'
			]},
			{t: 'h', text: 'Explaining the Coverage', id: 'dq-explain'},
			{t: 'note', text: 'Only move here once the Situation and Motivation DQs are done.'},
			{t: 'say', text: 'Perfect, and just so you are aware, these are **State-Regulated and Approved Whole Life plans** that are designed to cover 100% of your burial, cremation, or any other final expenses that you may have.'},
			{t: 'say', text: 'These plans come from carriers you’ve probably heard of, like Mutual of Omaha, Transamerica, Liberty, and American General Life.'},
			{t: 'say', text: 'These carriers are very easy to get approved for because there are no doctor visits, nurses, or medical exams required. Isn’t that great?'},
			{t: 'h', text: 'Beneficiary DQ', id: 'dq-beneficiary'},
			{t: 'note', text: 'Surface who the policy protects, then use the rapport follow-ups to build emotional attachment. Let them talk.'},
			{t: 'say', text: 'Now, {{lead name}}, let me ask you this — if something unexpected were to happen… who would be the loved one stepping in to hold everything together and pick up the pieces?'},
			{t: 'say', text: 'Got it… tell me a little about {{beneficiary}}.'},
			{t: 'list', items: [
				'**Spouse:** “How did you two meet?” & “How long have you been married?”',
				'**Child:** “Is he/she your favorite son/daughter?” & “Does your child and their family live near you?”'
			]},
			{t: 'say', text: 'Now, I know this can be a morbid question sometimes, but walk me through your ideal funeral situation and how you want to have that handled?'},
			{t: 'note', text: 'Pause and let them open up.'},
			{t: 'list', items: [
				'Were you wanting to have a burial or cremation?',
				'Did you just want to cover the basics, or did you have something else in mind?',
				'Do you also want to leave any extra money for the family?',
				'Did you want to cover any left-over credit card bills or medical bills?'
			]},
			{t: 'note', text: 'Only want cremation? → [Cremation-only trigger](#trg-cremation)'},
			{t: 'h', text: 'Consequence + Benefit DQ', id: 'dq-benefit'},
			{t: 'inst', title: 'Consequence → then Benefit', body: [
				'The consequence question makes the cost of doing nothing real. Deliver it gently, then pause and let the silence work.',
				'**IMPORTANT:** write their benefit answer down **word-for-word** — you’ll call it back in the [Pitch](#pitch) on Plans 2 and 3.'
			]},
			{t: 'say', text: '{{lead name}}, I was just wondering. If you did not have an insurance policy in place and heaven forbid you died in a car wreck tomorrow, would that be a heavy burden on {{beneficiary}}? They would not have to go through the embarrassment of opening up a GoFundMe account… would they?'},
			{t: 'say', text: 'And let’s say we do get you approved today — what would you want {{beneficiary}} to be able to do with that money, aside from covering your funeral expenses?'}
		]
	},
	{
		id: 'medical',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 3',
		title: 'Medical Questions',
		short: 'Medical',
		blocks: [
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'Perfect. It’s good that you have a clear picture of how you want the funeral to go — that makes our job a lot easier. So, I’ll bring up a few plans here shortly.'},
			{t: 'h', text: 'Health Questions (Eligibility)'},
			{t: 'say', text: 'Now, these plans are based on 2 things. The first is your age and the second is your health, and even if your health isn’t perfect, these plans do have generous underwriting guidelines that help you get approved, so it isn’t a huge deal.'},
			{t: 'list', items: ['Now as far as your age goes, how young are you?', 'What is your actual date of birth?']},
			{t: 'say', text: 'Ok great. And then as far as your health goes…'},
			{t: 'list', ordered: true, items: [
				'Have you used tobacco or nicotine in the last 12 months?',
				'And my mom would kill me for asking you this, but what’s a good height & weight for you?',
				'Have you ever been diagnosed with Congestive Heart Failure?',
				'Any Heart Attack, Stroke, Cancer, TIA (Transient Ischemic Attack), or Stents?',
				'COPD or inhaler use like albuterol? Oxygen?',
				'Diabetes — insulin? Complications such as amputation, neuropathy, or tingling in the feet?',
				'Any liver or kidney issues?',
				'Do you take prescription medications?',
				'What are they? What are you taking them for? (get each one individually)',
				'Any other conditions that you are being treated for by a doctor?'
			]},
			{t: 'note', text: 'They bring up a condition like diabetes? Don’t move past it → [Health Condition trigger](#trg-health)'},
			{t: 'choices', prompt: 'Their health…', options: [
				{label: 'Healthy', to: 'med-healthy'},
				{label: 'Not so healthy', to: 'med-not'}
			]},
			{t: 'path', id: 'med-healthy', label: 'If healthy', blocks: [
				{t: 'say', text: 'That’s great, sounds like you’re in good shape. What’s your secret?'}
			]},
			{t: 'path', id: 'med-not', label: 'If not', blocks: [
				{t: 'say', text: 'No problem at all, I appreciate you being upfront.'}
			]}
		]
	},
	{
		id: 'education',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 4',
		title: 'Education',
		blocks: [
			{t: 'h', text: 'Benefits of the Policy'},
			{t: 'say', text: 'Thank you for answering those questions. You’re making my job a lot easier. If you have a pen and paper nearby, go ahead and grab those so you can take down some notes while we go over these plans.'},
			{t: 'say', text: 'My full name is {{full name}}.'},
			{t: 'say', text: 'My personal cell phone number, so you can always reach me, is {{cell number}}.'},
			{t: 'say', text: 'My national insurance producer ID number — similar to a Social Security number in the insurance industry — is {{NPN}}.'},
			{t: 'note', text: 'Call your NPN your “insurance ID number,” like an SSN for the insurance industry — “NPN” is jargon to most callers.'},
			{t: 'say', text: 'And while we’re waiting for your options to load, I’ll go over the benefits of these plans again just so everything makes sense for you.'},
			{t: 'list', ordered: true, items: [
				'These are **State Approved Whole Life Plans** that protect your family and cover you for your whole entire life, and they do not cancel or expire on you.',
				'Your benefit amount will **never decrease**, and your monthly payments will **never increase**, even if you do get sick — and they’re designed to get more affordable as you receive those cost-of-living increases from Social Security.',
				'These do not require any medical exams, no blood testing, and we don’t need to send you to a doctor or nurse to get approved or stick any big needles in you.',
				'And lastly, with these plans you **do not have to pay anything today**. You can start on the 1st, 3rd, or whatever day you receive your benefits.'
			]},
			{t: 'say', text: 'Does that make sense?'},
			{t: 'h', text: 'Setting Expectations', id: 'edu-expectations'},
			{t: 'say', text: 'All right. Based on everything you shared with me, I’ve narrowed down a few plans that I think are a great starting point. Before we go through them, I do want to set one expectation.'},
			{t: 'say', text: 'The prices I’m about to give you are based on the information we discussed today. Once we submit the application, the insurance company completes its review. In many cases the premium does stay the same, but depending on underwriting it could end up a little lower, a little higher, or the company may recommend a different plan. If anything changes, I’ll review everything with you before it moves forward, so there won’t be any surprises.'},
			{t: 'say', text: 'And the options I’m about to give you are not the only options available. If one of these monthly payments is more than you’re comfortable with, that’s perfectly okay — we can adjust the amount of coverage until we find something that fits both your needs and your monthly budget. My goal is to help you find a policy you’re comfortable keeping for years to come, all right?'}
		]
	},
	{
		id: 'pitch',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 5',
		title: 'Pitch',
		blocks: [
			{t: 'h', text: 'Presenting Options'},
			{t: 'say', text: 'Perfect. Now I’ve got a few plans brought up here, and we can always adjust these to fit your needs better. Do you still have your pen and paper available? Please write these down.'},
			{t: 'say', text: 'So, let’s start with the first one:'},
			{t: 'h', text: 'Plan 1'},
			{t: 'say', text: 'The first plan will leave {{beneficiary}} {{$XX,XXX}} in coverage. This will be enough to cover the burial/cremation entirely.'},
			{t: 'list', items: ['That plan comes out to a monthly fixed amount of {{$ amount}}.']},
			{t: 'h', text: 'Plan 2'},
			{t: 'inst', title: 'Insert their Benefit DQ answer', body: [
				'Call back their **exact words** from the [Benefit DQ](#dq-benefit) — e.g. “plus a little extra so {{beneficiary}} can {{their exact words — pay off the car, take time off work, keep the house…}}”'
			]},
			{t: 'say', text: 'The second plan is for {{$XX,XXX}} in coverage. This will be enough to cover the burial/cremation entirely, plus give the family a little extra to put in the bank account.'},
			{t: 'list', items: ['That is a monthly fixed amount of {{$ amount}}.']},
			{t: 'h', text: 'Plan 3'},
			{t: 'inst', title: 'Insert their Benefit DQ answer — scaled up', body: [
				'Same callback, bigger — “plus quite a bit extra so {{beneficiary}} can {{their exact words}} without any stress.” Their own words sell the bigger plan better than yours will.'
			]},
			{t: 'say', text: 'The third plan will leave {{beneficiary}} {{$XX,XXX}} in coverage. This will be enough to cover the burial/cremation entirely, plus give them quite a bit extra.'},
			{t: 'list', items: ['That is a monthly fixed amount of {{$ amount}}.']},
			{t: 'note', text: 'Adjust coverage or payment details as needed.'},
			{t: 'h', text: 'The Ask', id: 'pitch-ask'},
			{t: 'say', text: 'If anything were to happen to you, which one of these options do you want {{beneficiary}} to receive as a check?'},
			{t: 'choices', prompt: 'Prospect…', options: [
				{label: 'Selects a plan', to: 'pitch-selected'},
				{label: '“It’s too expensive”', to: 'obj-expensive'},
				{label: '“I need to think about it”', to: 'obj-think'},
				{label: '“I want the $25k / $40k policy”', to: 'obj-want-25k'}
			]},
			{t: 'path', id: 'pitch-selected', label: 'Prospect selects one', blocks: [
				{t: 'say', text: 'Perfect, I think that’s a good choice too, because it will cover what you need completely. And just to confirm, is that going to be comfortable monthly for you? Ok. Sounds good. We’ll go ahead and submit the application to the carrier for that then.'}
			]}
		]
	},
	{
		id: 'app',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 6',
		title: 'Application',
		short: 'App',
		blocks: [
			{t: 'h', text: 'Client Information'},
			{t: 'say', text: 'Now, when we get pre-approval, the first thing the carrier will ask us for is the spelling of your first and last name. Please spell that for me whenever you’re ready.'},
			{t: 'list', ordered: true, items: ['First Name', 'Last Name', 'Phone Number']},
			{t: 'say', text: 'Is this a cell phone or a home phone?'},
			{t: 'note', text: 'Confirm cell. If home, ask if they can get an email.'},
			{t: 'say', text: 'Ok, and if I send you a text message on this phone you can get it, right? Ok, perfect. And then what’s the best email for you?'},
			{t: 'list', ordered: true, items: ['Email', 'Complete Home/Mailing Address', 'Birth State']},
			{t: 'h', text: 'Beneficiary'},
			{t: 'say', text: 'Ok, and who did you want to be your beneficiary?'},
			{t: 'list', ordered: true, items: ['Beneficiary Relation', 'Beneficiary Name', 'Beneficiary DOB']},
			{t: 'say', text: 'Did you want to add any other beneficiaries, or just them? Did you want them to get a copy of the policy too, or just you?'},
			{t: 'note', text: 'If yes, get the beneficiary’s address.'},
			{t: 'h', text: 'Citizenship + SSN', id: 'app-ssn'},
			{t: 'say', text: 'And this next one I already know, but you are a US citizen, right? Ok, perfect.'},
			{t: 'say', text: 'And if anything were to happen to you, your family would receive a death certificate with your Social Security number on it, and the carrier uses that to verify the benefits go to the right beneficiaries. Since there’s no medical exam, they’ll also do a quick background check to confirm the health information we discussed. Because of that, they’ll have us verify your Social, so go ahead with that whenever you’re ready.'},
			{t: 'note', text: 'Share screen if necessary — this is where objections tend to show up.'},
			{t: 'list', ordered: true, items: ['SSN']},
			{t: 'h', text: 'Effective Date'},
			{t: 'say', text: 'Ok, thank you. Now when you get your benefits, do they normally come on the 1st, the 3rd, or on a Wednesday?'},
			{t: 'note', text: 'Make the effective date the same as the benefits date, or the day after.'},
			{t: 'list', ordered: true, items: ['Effective Date']},
			{t: 'say', text: 'Ok, and if we start the plan on {{effective date}} this works for you? And the {{XX}} of every month works too? Ok, perfect.'},
			{t: 'say', text: 'So now we’ll go ahead and run the approval for you. This will take just a couple minutes, and in the meantime you’ll get a text message/email here shortly, so I’ll walk you through that.'},
			{t: 'note', text: 'Get the approval, then go over the plan again.'},
			{t: 'h', text: 'Approval + Banking', id: 'app-banking'},
			{t: 'say', text: 'Ok, so we did get the approval — congratulations! They said you were very healthy, so nothing changed from what I told you originally.'},
			{t: 'say', text: 'Now, this plan will start on {{effective date}}. When it begins, did you want that to come from a checking or savings account? Ok, perfect. And what’s the bank you bank with?'},
			{t: 'list', ordered: true, items: ['Bank Name']},
			{t: 'note', text: 'As soon as they tell you, look up their routing number and confirm it.'},
			{t: 'say', text: 'It looks like they are one of our partner banks, so their routing number automatically pops up in our system — it is {{routing number}}.'},
			{t: 'note', text: 'Let them confirm. Then, without hesitation:'},
			{t: 'say', text: 'Ok, and the account number?'},
			{t: 'list', ordered: true, items: ['Bank Routing', 'Bank Account Number']}
		]
	},
	{
		id: 'closing',
		kind: 'section',
		group: 'script',
		eyebrow: 'Section 7',
		title: 'Closing',
		blocks: [
			{t: 'h', text: 'Wrap Up'},
			{t: 'say', text: 'Now we’re just about completed. If you still have the pen and paper, I’ll have you write down a few important pieces of information.'},
			{t: 'list', items: ['Policy Number', 'Carrier', 'Benefit Amount', 'Monthly Premium', 'Start Date', 'Beneficiary', 'Customer Service Number']},
			{t: 'note', text: 'Confirm your info once again with them.'},
			{t: 'say', text: 'Now, you’ll get a package in the mail in about 7–10 business days that will have all this information in it as well, so you can review.'},
			{t: 'say', text: 'When you get it, make sure to make a copy for yourself and one for your beneficiary. If God forbid anything happens to you, they’ll call the number on the policy once they have the death certificate to receive the {{benefit amount}} within 24–48 hours.'},
			{t: 'h', text: 'Security Code'},
			{t: 'say', text: 'And now, I’m going to give you a quick security code: {{memorable code, like your birthdate}}.'},
			{t: 'say', text: 'If you ever receive another call from someone about your Final Expense policy telling you to make changes, simply ask them for this code.'},
			{t: 'say', text: 'If they can’t provide it, please hang up immediately. That means they are not working with me or on my behalf, so do not share any personal information with them.'},
			{t: 'note', text: 'Wait for the caller to respond.'},
			{t: 'h', text: 'Referral + Goodbye'},
			{t: 'say', text: 'And lastly, now that you and your family are taken care of, do you happen to know anyone else who might benefit from Final Expense coverage to help protect their family as well? If so, feel free to share my number with them.'},
			{t: 'say', text: 'Other than that, we are all set — but if you have any questions, please don’t hesitate to ask. Have a good one!'}
		]
	},

	// ─────────────────────────── OBJECTIONS ───────────────────────────
	{
		id: 'obj-free',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 1',
		title: '“I thought it’s FREE — that’s what I saw on the ads”',
		short: 'It’s free',
		blocks: [
			{t: 'step', text: 'Step 1 · Agree & Acknowledge (don’t argue)'},
			{t: 'say', text: 'Absolutely! I’d love free Final Expense insurance too if that existed, and I completely understand why you’d think that.'},
			{t: 'say', text: 'What the ad is referring to is the **free quote** and finding out what you qualify for. There isn’t any cost to see your options or speak with a licensed benefits coordinator.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I understand, was the main reason you called because you thought the coverage itself was free, or were you also looking into making sure your family wouldn’t have to pay for your funeral expenses someday?'},
			{t: 'choices', prompt: 'Caller says…', options: [
				{label: '“I just wanted the free insurance”', to: 'obj-free-a'},
				{label: '“I wanted my family protected”', to: 'obj-free-b'}
			]},
			{t: 'path', id: 'obj-free-a', label: 'Path A — “I just wanted the free insurance.”', blocks: [
				{t: 'note', text: 'Don’t jump into pricing. Shift their mindset by helping them see the cost of having no coverage.'},
				{t: 'h', text: 'DQ 1'},
				{t: 'say', text: 'Do you already have any Final Expense or life insurance in place today?'},
				{t: 'choices', options: [
					{label: 'Yes, has coverage', to: 'obj-free-a-yes'},
					{label: 'No coverage', to: 'obj-free-a-no'}
				]},
				{t: 'path', id: 'obj-free-a-yes', label: 'If YES', blocks: [
					{t: 'say', text: 'That’s great. About how much coverage do you currently have?'},
					{t: 'say', text: 'Do you feel that’s enough to cover everything you want, or are there still some expenses your family might have to pay out of pocket?'},
					{t: 'note', text: 'If they mention a small policy:'},
					{t: 'say', text: 'If funeral costs ended up being closer to $20,000 and your policy only covered $5,000, who do you think would be responsible for the remaining balance?'}
				]},
				{t: 'path', id: 'obj-free-a-no', label: 'If NO — emotional discovery', blocks: [
					{t: 'list', ordered: true, items: [
						'If something happened tomorrow, who would most likely be responsible for paying for your funeral?',
						'Do you think your children, your spouse, or your family could comfortably come up with $15,000 to $25,000 within a couple of days?',
						'How would you feel knowing that while your family is grieving, they also have to figure out how they’re going to pay for everything?',
						'Would that be a pretty heavy financial burden for them?',
						'Most parents and spouses I speak with tell me they never want their family to have to go through that. Would you say you feel the same way?',
						'At the end of the day, would you rather leave your family with money to help them through that difficult time, or leave them with bills they have to figure out?'
					]},
					{t: 'note', text: 'Pause and let the caller answer.'}
				]},
				{t: 'h', text: 'Transition'},
				{t: 'say', text: 'That’s exactly why so many people decide to put something in place. It’s not because anyone expects something to happen tomorrow — it’s because they want their family protected whenever that day eventually comes.'},
				{t: 'note', text: 'Then continue with the normal [Discovery](#dq) and qualification process.'}
			]},
			{t: 'path', id: 'obj-free-b', label: 'Path B — “No, I really just wanted to make sure my family was protected.”', blocks: [
				{t: 'note', text: 'Reinforce their motivation.'},
				{t: 'say', text: 'I completely understand, and honestly that’s exactly why most people reach out to us.'},
				{t: 'say', text: 'Let’s make sure we find something that protects your family without stretching your monthly budget.'},
				{t: 'note', text: 'Then continue into the product discussion → [Education](#education).'}
			]},
			{t: 'exit', to: 'dq', label: 'Discovery'}
		]
	},
	{
		id: 'obj-think',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 2',
		title: '“I need to think about it.”',
		short: 'Think about it',
		blocks: [
			{t: 'step', text: 'Step 1 · Acknowledge'},
			{t: 'say', text: 'Absolutely, I understand. This is an important decision and I wouldn’t expect you to make it lightly.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I know how best to help you… what specifically would you like to think about?'},
			{t: 'note', text: 'Pause.'},
			{t: 'choices', prompt: 'It’s about…', options: [
				{label: 'Price', to: 'obj-think-a'},
				{label: 'Talking to family', to: 'obj-think-b'},
				{label: 'Needs time', to: 'obj-think-c'}
			]},
			{t: 'path', id: 'obj-think-a', label: 'Path A — Price', blocks: [
				{t: 'say', text: 'I completely understand. Can I ask… is it the monthly payment itself, or is it just fitting it comfortably into your budget?'},
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'About what monthly payment would feel comfortable for you?'},
				{t: 'note', text: 'If lower:'},
				{t: 'say', text: 'Perfect, let’s see if we can adjust the coverage so you’re still protecting your family while staying within a payment you’re comfortable with.'},
				{t: 'note', text: 'Deeper price handling → [Too Expensive](#obj-expensive)'}
			]},
			{t: 'path', id: 'obj-think-b', label: 'Path B — Wants to discuss with family', blocks: [
				{t: 'say', text: 'I completely respect that.'},
				{t: 'say', text: 'Out of curiosity, what do you think your {{son / daughter / spouse}} would want you to do if they knew this policy would keep them from paying those funeral expenses themselves?'},
				{t: 'note', text: 'Or:'},
				{t: 'say', text: 'If they were sitting here with us, do you think protecting them would still be the priority?'}
			]},
			{t: 'path', id: 'obj-think-c', label: 'Path C — Needs time', blocks: [
				{t: 'say', text: 'Of course. Can I ask what information you’re still missing, so I can make sure you have everything before you decide?'}
			]},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'My job isn’t to pressure you. It’s simply to make sure you have enough information to make the best decision for your family.'},
			{t: 'exit', to: 'pitch-ask', label: 'The Ask'}
		]
	},
	{
		id: 'obj-expensive',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 3',
		title: '“It’s too expensive.”',
		short: 'Too expensive',
		blocks: [
			{t: 'step', text: 'Step 1 · Agree & Acknowledge'},
			{t: 'say', text: 'I completely understand, and I appreciate you being honest with me. Nobody wants to take on another monthly expense.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I understand, when you say it’s too expensive, is it the monthly payment itself, or were you expecting the coverage to cost something different?'},
			{t: 'note', text: 'Pause and let the caller answer.'},
			{t: 'choices', prompt: 'Caller says…', options: [
				{label: '“The monthly payment is too high”', to: 'obj-exp-a'},
				{label: '“I didn’t expect it to cost that much”', to: 'obj-exp-b'},
				{label: '“I can’t afford it”', to: 'obj-exp-c'}
			]},
			{t: 'path', id: 'obj-exp-a', label: 'Path A — “The monthly payment is too high”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'I completely understand. Before I see what adjustments we can make, about what monthly payment would feel comfortable for you?'},
				{t: 'note', text: 'Let them answer.'},
				{t: 'h', text: 'Re-anchor'},
				{t: 'say', text: 'Perfect. My goal isn’t to sell you something that stretches your budget. My job is to make sure your family is protected with a payment you’re actually comfortable making.'},
				{t: 'h', text: 'Transition'},
				{t: 'say', text: 'Let’s see if we can adjust the coverage while still making sure your family isn’t left paying those final expenses out of pocket.'}
			]},
			{t: 'path', id: 'obj-exp-b', label: 'Path B — “I didn’t expect it to cost that much”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'I understand. Out of curiosity, what were you expecting it to cost?'},
				{t: 'note', text: 'Pause.'},
				{t: 'h', text: 'Educate'},
				{t: 'say', text: 'A lot of people are surprised at first because they haven’t priced Final Expense coverage before. The monthly premium is based on things like age, health, and the amount of coverage you choose.'},
				{t: 'h', text: 'Re-anchor'},
				{t: 'say', text: 'The good news is we can usually adjust the coverage to find something that protects your family without going beyond your budget.'}
			]},
			{t: 'path', id: 'obj-exp-c', label: 'Path C — “I can’t afford it”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'I understand. Can I ask — is it that you truly can’t fit another payment into your budget, or is there another concern that’s making you hesitate?'},
				{t: 'note', text: 'Pause. If it’s budget-related:'},
				{t: 'say', text: 'What monthly payment would realistically work for you?'},
				{t: 'h', text: 'Emotional Re-anchor'},
				{t: 'say', text: 'Earlier you mentioned your biggest concern was making sure your family wouldn’t have to pay for these expenses.'},
				{t: 'say', text: 'I don’t want you to leave this call feeling like it’s all or nothing. Even a smaller amount of coverage can make a tremendous difference for your family.'},
				{t: 'h', text: 'If the caller still hesitates'},
				{t: 'warn', text: 'Don’t immediately drop the price — help them weigh the trade-off first.'},
				{t: 'say', text: 'If we can find a payment that fits comfortably within your budget, would protecting your family still be something you’d want to take care of today?'},
				{t: 'note', text: 'If yes, continue adjusting the coverage. If they remain hesitant:'},
				{t: 'say', text: 'Would you rather adjust the amount of coverage so it fits your budget, or leave your family responsible for covering whatever isn’t protected?'}
			]},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'Let’s work together to find the right balance. My job isn’t to recommend the biggest policy — it’s to help you find one that’s meaningful for your family and comfortable for your monthly budget.'},
			{t: 'h', text: 'Optional Assumptive Close'},
			{t: 'say', text: 'Let’s take a look at a few options that fit the payment you’re comfortable with, and we’ll build the right amount of protection from there.'},
			{t: 'exit', to: 'pitch', label: 'the Pitch (re-quote)'}
		]
	},
	{
		id: 'obj-have-insurance',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 4',
		title: '“I already have insurance.”',
		short: 'Already insured',
		blocks: [
			{t: 'step', text: 'Step 1 · Acknowledge'},
			{t: 'say', text: 'That’s actually great to hear. I’m glad you’ve already taken the first step toward protecting your family.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I understand, if you already have insurance in place, what made you decide to call us today? Was it because you’re not completely satisfied with your current coverage, or were you simply looking to see if you should add more protection?'},
			{t: 'choices', prompt: 'Caller says…', options: [
				{label: '“Not satisfied with my policy”', to: 'obj-ins-a'},
				{label: '“I just want more coverage”', to: 'obj-ins-b'},
				{label: '“I thought I had enough”', to: 'obj-ins-c'}
			]},
			{t: 'path', id: 'obj-ins-a', label: 'Path A — “I’m not satisfied with my current policy”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'I’d be happy to help with that. Can I ask what you’re not satisfied with? Is it the coverage amount, the monthly payment, the waiting period, or something else?'},
				{t: 'list', items: ['Who is your current policy with?', 'About how much coverage do you currently have?', 'How long have you had the policy?']},
				{t: 'h', text: 'Reassure the Caller'},
				{t: 'say', text: 'Don’t worry. As your Benefits Coordinator today, my job is simply to make sure you have the protection you actually need. We’ll review what you already have, identify any gaps, and if additional coverage makes sense, I’ll show you the most affordable option that fits your needs and budget.'}
			]},
			{t: 'path', id: 'obj-ins-b', label: 'Path B — “I just want more coverage”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'That makes perfect sense. A lot of families already have some coverage and simply realize it may not be enough anymore.'},
				{t: 'list', items: ['About how much coverage do you currently have?', 'What made you feel like you might need additional protection?']},
				{t: 'h', text: 'If coverage is low'},
				{t: 'say', text: 'If funeral costs ended up being closer to $20,000 and your current policy only covered $5,000 or $10,000, who do you think would most likely be responsible for the remaining balance?'},
				{t: 'say', text: 'Would you feel comfortable leaving that portion for your family to figure out?'}
			]},
			{t: 'path', id: 'obj-ins-c', label: 'Path C — “I thought I had enough”', blocks: [
				{t: 'h', text: 'Temp Check'},
				{t: 'say', text: 'That’s great. Out of curiosity, when was the last time you reviewed your policy?'},
				{t: 'say', text: 'Do you feel it still covers everything you want based on today’s funeral costs?'},
				{t: 'h', text: 'If they aren’t sure'},
				{t: 'say', text: 'Funeral costs have continued to increase over the years, and many people discover that the coverage they purchased years ago no longer fully protects their family. That’s why we’re taking a few minutes to review it together today.'}
			]},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'Many of the families I help already have insurance in place. They aren’t starting over — they’re simply making sure there aren’t any gaps in coverage. Let’s take a look at what you already have and see if there’s anything we can do to make sure your family is fully protected without paying for more than you actually need.'},
			{t: 'h', text: 'Optional Assumptive Transition'},
			{t: 'say', text: 'If everything looks good, I’ll be the first to tell you. But if we find a gap, we’ll put together the most affordable solution to complete your protection so your family isn’t left with unexpected expenses.'},
			{t: 'note', text: 'More questions for this caller → [Already Has Coverage trigger](#trg-coverage)'},
			{t: 'exit', to: 'dq', label: 'Discovery'}
		]
	},
	{
		id: 'obj-255',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 5',
		title: '“I heard there’s a free government benefit of $255.”',
		short: '$255 benefit',
		blocks: [
			{t: 'step', text: 'Step 1 · Agree & Acknowledge'},
			{t: 'say', text: 'Yes, many people have heard about the Social Security death benefit, and I’m glad you brought it up.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I understand, were you under the impression that the $255 benefit would cover your funeral expenses, or were you simply wondering how it works?'},
			{t: 'note', text: 'Pause and let the caller answer.'},
			{t: 'choices', prompt: 'Caller says…', options: [
				{label: '“I thought it covered the funeral”', to: 'obj-255-a'},
				{label: '“I just wanted to know about it”', to: 'obj-255-b'},
				{label: '“That’s all my family will need”', to: 'obj-255-c'}
			]},
			{t: 'path', id: 'obj-255-a', label: 'Path A — “I thought it covered the funeral”', blocks: [
				{t: 'h', text: 'Educate'},
				{t: 'say', text: 'I completely understand why you’d think that. The $255 Social Security death benefit is a one-time payment that some eligible survivors may receive, but it’s separate from Final Expense insurance and it’s not designed to cover the full cost of a funeral.'},
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'Have you had a chance to look into what funeral costs are running in your area these days?'},
				{t: 'note', text: 'If they say no:'},
				{t: 'say', text: 'Depending on the type of service and arrangements, many funerals today can cost anywhere from **$15,000 to $25,000**, sometimes even more.'},
				{t: 'h', text: 'Emotional Re-anchor'},
				{t: 'say', text: 'If there were still thousands of dollars left after that benefit, who do you think would most likely have to cover the remaining expenses? Would that place a financial burden on your family?'}
			]},
			{t: 'path', id: 'obj-255-b', label: 'Path B — “I just wanted to know about it”', blocks: [
				{t: 'h', text: 'Educate'},
				{t: 'say', text: 'That’s a great question. Many callers ask about it because they’ve seen it online or heard about it from someone else.'},
				{t: 'say', text: 'The Social Security benefit and Final Expense insurance serve two very different purposes. The government benefit, if someone qualifies, is a small one-time payment, while Final Expense insurance is designed to provide enough money to help your family cover funeral costs and other final expenses.'},
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'Can I ask what your biggest goal is? Is it simply covering the funeral, leaving something behind for your family, or a little bit of both?'}
			]},
			{t: 'path', id: 'obj-255-c', label: 'Path C — “I think that’s all my family will need”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'Can I ask you something? If your family received $255, do you think that would be enough to cover the funeral and everything else you’d want taken care of?'},
				{t: 'note', text: 'Pause.'},
				{t: 'h', text: 'Emotional Re-anchor'},
				{t: 'say', text: 'Most people I speak with want their family focused on being together and grieving — not trying to figure out how to come up with the rest of the money. That’s exactly why they choose to have something additional in place.'}
			]},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'The Social Security benefit can certainly help with a small portion of the expenses if someone qualifies, but it’s not intended to replace Final Expense coverage. Let’s take a look at what you actually need so your family isn’t left paying the difference out of pocket.'},
			{t: 'h', text: 'Optional Assumptive Transition'},
			{t: 'say', text: 'We’ll build a plan around your family’s needs and your budget, so you know exactly where they’ll stand when that day eventually comes.'},
			{t: 'exit', to: 'dq', label: 'Discovery'}
		]
	},
	{
		id: 'obj-existing-policy',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 6',
		title: '“I have questions about my existing policy” / “I need to talk to the previous agent”',
		short: 'Customer service call',
		blocks: [
			{t: 'step', text: 'Step 1 · Acknowledge'},
			{t: 'say', text: 'Absolutely, I’d be happy to point you in the right direction.'},
			{t: 'step', text: 'Step 2 · Temp Check'},
			{t: 'say', text: 'Just so I understand, is your question about your billing, your policy benefits, your coverage amount, or something else?'},
			{t: 'note', text: 'Let them answer.'},
			{t: 'choices', prompt: 'They want…', options: [
				{label: 'Customer service (billing, beneficiary…)', to: 'obj-cs-a'},
				{label: 'To speak to the previous agent', to: 'obj-cs-b'}
			]},
			{t: 'path', id: 'obj-cs-a', label: 'Path A — Customer service request', blocks: [
				{t: 'note', text: 'Something only the carrier or original agent can handle (billing, beneficiary change, payment status…):'},
				{t: 'say', text: 'I definitely don’t want to guess or give you inaccurate information, so for anything specific to your existing policy, the carrier or the licensed agent who helped you originally would be the best resource.'},
				{t: 'h', text: 'Then pivot instead of ending the call'},
				{t: 'say', text: 'Since I’ve got you on the phone though, can I ask you something?'},
				{t: 'note', text: 'Wait for permission.'},
				{t: 'say', text: 'When was the last time someone reviewed your coverage to make sure it still matches what you want for your family today?'},
				{t: 'h', text: 'If they say “It’s been a while”'},
				{t: 'say', text: 'A lot can change over the years — funeral costs continue to increase, health changes, and many people find out they’re either underinsured or paying more than they need to.'},
				{t: 'say', text: 'While you get those customer service questions answered, I’d be happy to do a complimentary coverage review with you today. That way you’ll know whether your current policy still gives your family the protection you’re looking for.'},
				{t: 'h', text: 'Discovery Questions'},
				{t: 'list', items: [
					'About how much coverage do you currently have?',
					'Who did you name as your beneficiary?',
					'If something happened tomorrow, do you feel that amount would completely cover everything you want?',
					'Has anything changed since you first purchased that policy?'
				]},
				{t: 'h', text: 'If they reveal gaps'},
				{t: 'say', text: 'I’m really glad you mentioned that. That’s exactly the kind of thing we help people review every day. Let’s take a few minutes to see whether what you already have is still enough, or if there’s a simple way to make sure your family is fully protected.'}
			]},
			{t: 'path', id: 'obj-cs-b', label: 'Path B — They want to speak to the previous agent', blocks: [
				{t: 'say', text: 'Of course, and if your question is specific to that policy, they’re definitely the best person to answer it.'},
				{t: 'h', text: 'Then transition'},
				{t: 'say', text: 'Before I let you go though, can I ask you one quick question?'},
				{t: 'note', text: 'Pause.'},
				{t: 'say', text: 'If we found out today that your current coverage wasn’t enough to fully protect your family, would you want to know about it?'},
				{t: 'note', text: 'If they say yes:'},
				{t: 'say', text: 'Perfect. Let’s do a quick review together. It’ll only take a few minutes, and at the end you’ll know whether you’re in great shape or if there are any gaps we should address.'}
			]},
			{t: 'exit', to: 'dq', label: 'Discovery'}
		]
	},
	{
		id: 'obj-claim-25k',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 7',
		title: '“I want to claim the $25,000 / $40,000 free benefit.”',
		short: 'Claim the $25k/$40k',
		blocks: [
			{t: 'step', text: 'Step 1 · Agree & Acknowledge'},
			{t: 'say', text: 'Absolutely! I completely understand why you called, and I’m glad you reached out. A lot of people call after seeing those advertisements, so you’re definitely not the only one.'},
			{t: 'step', text: 'Step 2 · Clarify (don’t argue)'},
			{t: 'say', text: 'Just to clarify, the $25,000 and $40,000 shown in the ad refer to the amount of Final Expense coverage that some people may qualify for. The good news is that getting a quote, reviewing your options, and finding out what you qualify for is completely free.'},
			{t: 'step', text: 'Step 3 · Temp Check'},
			{t: 'say', text: 'Just so I can better help you, were you mainly calling because you wanted to claim that amount, or were you looking to make sure your family would be protected from funeral expenses when that day eventually comes?'},
			{t: 'note', text: 'Pause and let the caller answer.'},
			{t: 'choices', prompt: 'Caller says…', options: [
				{label: '“I just want the $25k / $40k”', to: 'obj-claim-a'},
				{label: '“I just want to protect my family”', to: 'obj-claim-b'}
			]},
			{t: 'path', id: 'obj-claim-a', label: 'Path A — “I just want the $25,000 / $40,000 benefit”', blocks: [
				{t: 'h', text: 'Discovery'},
				{t: 'say', text: 'I completely understand. Can I ask what made that amount stand out to you?'},
				{t: 'note', text: 'Pause.'},
				{t: 'say', text: 'Were you thinking that amount would cover your funeral, leave something behind for your family, or both?'},
				{t: 'h', text: 'Re-anchor'},
				{t: 'say', text: 'That makes perfect sense. Rather than guessing at a number, my job is to make sure you have enough coverage to accomplish exactly what you want for your family without paying for more than you actually need.'}
			]},
			{t: 'path', id: 'obj-claim-b', label: 'Path B — “I just want to protect my family”', blocks: [
				{t: 'h', text: 'Reinforce'},
				{t: 'say', text: 'I completely understand, and that’s exactly why most people reach out to us. Let’s make sure we find the amount of coverage that fully protects your family while keeping the monthly payment comfortable for you.'}
			]},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'The first step is learning a little more about what you’re trying to protect. Once I understand your situation, I’ll show you the options you qualify for and help you find the coverage that best fits your needs and budget.'},
			{t: 'h', text: 'Optional Assumptive Transition'},
			{t: 'say', text: 'Let’s start by talking about who you’re protecting and what you want the policy to accomplish, and then we’ll build the right amount of coverage from there.'},
			{t: 'exit', to: 'dq', label: 'Discovery'}
		]
	},
	{
		id: 'obj-want-25k',
		kind: 'objection',
		group: 'objections',
		eyebrow: 'Objection 8',
		title: '“I want the $25,000 / $40,000 policy.”',
		short: 'Wants the $25k/$40k policy',
		blocks: [
			{t: 'note', text: 'Caller may or may not qualify / be able to afford it.'},
			{t: 'step', text: 'Step 1 · Validate'},
			{t: 'say', text: 'Absolutely. Most people would love to leave that much behind for their family.'},
			{t: 'step', text: 'Step 2 · Set Expectations'},
			{t: 'say', text: 'The exact amount someone qualifies for depends on several factors, including age, health, and what feels comfortable for their monthly budget.'},
			{t: 'step', text: 'Temp Check'},
			{t: 'say', text: 'Can I ask… what made you choose that amount?'},
			{t: 'choices', prompt: 'Caller…', options: [
				{label: 'Thinks that’s what’s needed', to: 'obj-want-a'},
				{label: 'Just wants maximum coverage', to: 'obj-want-b'}
			]},
			{t: 'path', id: 'obj-want-a', label: 'Path A — They think that’s what’s needed', blocks: [
				{t: 'say', text: 'What expenses were you hoping that amount would cover?'}
			]},
			{t: 'path', id: 'obj-want-b', label: 'Path B — They just want maximum coverage', blocks: [
				{t: 'say', text: 'If we could fully cover your funeral expenses while keeping your monthly payment much more affordable, would that accomplish what you’re looking for?'}
			]},
			{t: 'h', text: 'Re-anchor'},
			{t: 'say', text: 'The goal isn’t necessarily having the biggest policy. The goal is making sure your family has enough money so they don’t have to come out of pocket when that day comes.'},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'Let’s first figure out exactly what your family would need, then we’ll build the right amount of coverage around that.'},
			{t: 'exit', to: 'pitch-ask', label: 'The Ask'}
		]
	},

	// ──────────────────────── EMOTIONAL TRIGGERS ────────────────────────
	{
		id: 'triggers',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Guide',
		title: 'Identifying Emotional Triggers',
		short: 'Overview',
		blocks: [
			{t: 'say', text: 'One of the biggest mistakes agents make is focusing too quickly on pricing and coverage amounts without first understanding the caller’s motivation. Final Expense is an emotional product. Most people are not shopping for insurance — they are looking for **peace of mind** and a way to protect the people they care about.'},
			{t: 'say', text: 'Listen for emotional triggers and use thoughtful follow-up questions to help callers expand on their concerns.'},
			{t: 'choices', prompt: 'Caller mentions…', options: [
				{label: 'A recent loss', to: 'trg-loss'},
				{label: 'Not wanting to burden family', to: 'trg-burden'},
				{label: 'Living on Social Security', to: 'trg-ss'},
				{label: 'Already having coverage', to: 'trg-coverage'},
				{label: 'A health condition', to: 'trg-health'},
				{label: '“Not interested”', to: 'trg-not-interested'},
				{label: 'Kids / grandkids', to: 'trg-kids'},
				{label: 'Delaying for years', to: 'trg-delay'},
				{label: 'Cremation only', to: 'trg-cremation'},
				{label: '“My family will handle it”', to: 'trg-family'}
			]}
		]
	},
	{
		id: 'trg-loss',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 1',
		title: 'Caller mentions a recent loss',
		short: 'Recent loss',
		blocks: [
			{t: 'caller', text: 'My husband passed away last year.'},
			{t: 'inst', title: 'Why it matters', body: ['A caller who has recently experienced a loss already understands the financial and emotional impact. Understand their motivation rather than immediately moving to qualification questions.']},
			{t: 'warn', text: 'Avoid: “Okay, and how old are you?”'},
			{t: 'h', text: 'Better approach'},
			{t: 'say', text: 'I’m very sorry to hear that. If you don’t mind me asking, how did your family handle everything financially when that happened?'},
			{t: 'say', text: 'Was that experience one of the reasons you decided to start looking into coverage for yourself?'},
			{t: 'say', text: 'What is your main goal when it comes to making sure your family won’t have to worry about unexpected costs?'}
		]
	},
	{
		id: 'trg-burden',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 2',
		title: 'Caller doesn’t want to burden their family',
		short: 'Don’t burden family',
		blocks: [
			{t: 'caller', text: 'I just don’t want my kids to have to pay for my funeral.'},
			{t: 'inst', title: 'Why it matters', body: ['Many Final Expense buyers are motivated by protecting loved ones from financial stress.']},
			{t: 'h', text: 'Follow-up questions'},
			{t: 'list', items: [
				'That’s very thoughtful of you. Have you had a chance to talk to them about that?',
				'If everything had to be handled tomorrow, would they be financially prepared for those expenses?',
				'So your goal is really to make sure they can focus on family rather than worrying about unexpected costs?',
				'What would it mean to you knowing your family wouldn’t have to worry about paying for your final expenses?'
			]},
			{t: 'h', text: 'Other good options'},
			{t: 'list', items: [
				'How important is it for you to make sure your children are not left with those expenses?',
				'What concerns you most about your family having to handle those costs?',
				'What would you want your family to be able to focus on when that time comes?'
			]}
		]
	},
	{
		id: 'trg-ss',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 3',
		title: 'Caller lives on Social Security',
		short: 'On Social Security',
		blocks: [
			{t: 'caller', text: 'I only live on Social Security.'},
			{t: 'inst', title: 'Why it matters', body: ['They may worry about affordability, but they may also be calling because they don’t want their family to struggle financially later. Price pushback later → [Too Expensive](#obj-expensive).']},
			{t: 'h', text: 'Listen for'},
			{t: 'list', items: ['Fixed income', 'Budget concerns', 'Fear of becoming a financial burden', 'Limited ability to handle unexpected expenses']},
			{t: 'h', text: 'Follow-up questions'},
			{t: 'list', items: [
				'I understand. That’s actually one of the reasons many people look into this type of coverage.',
				'If an unexpected expense came up, would your family need to step in and help financially?',
				'Is protecting your family from that responsibility one of the reasons you’re exploring your options today?',
				'Many people on a fixed income look into this because they want to know what options are affordable for them.',
				'What concerns you most about handling final expenses while living on a fixed income?',
				'If something unexpected happened, how do you think your family would handle those costs?',
				'What would give you peace of mind when it comes to making sure your family is not left with that responsibility?'
			]}
		]
	},
	{
		id: 'trg-coverage',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 4',
		title: 'Caller already has coverage',
		short: 'Has coverage',
		blocks: [
			{t: 'caller', text: 'I already have a policy.'},
			{t: 'warn', text: 'Don’t assume the need is covered.'},
			{t: 'h', text: 'Listen for'},
			{t: 'list', items: ['Existing coverage', 'Possibly outdated policy', 'Unclear coverage amount', 'A gap between coverage and actual final expenses']},
			{t: 'h', text: 'Sample questions'},
			{t: 'list', items: [
				'That’s great. When was the last time you reviewed your policy?',
				'Do you know exactly how much coverage it provides today?',
				'Would that amount fully cover funeral expenses and any final bills?',
				'That’s good that you already have something in place. What made you feel like calling in today?',
				'If you already have coverage, what were you hoping to find out today?',
				'What caught your attention about the information you saw?',
				'What made you want to take a second look at your options?',
				'Is there something about your current policy that you’re unsure about?',
				'What were you hoping this coverage could do differently from what you already have?',
				'When you called in today, were you mainly looking to compare, add more coverage, or just make sure your family is fully protected?',
				'What changed recently that made you think about this again?',
				'What would make you feel more comfortable about the coverage you already have?',
				'Is there a reason you wanted to check if there may be a better option available?'
			]},
			{t: 'h', text: 'Talking point'},
			{t: 'say', text: 'Funeral costs continue to rise, and many families discover there’s a gap between what they expected and what is actually needed.'},
			{t: 'note', text: 'Full rebuttal → [Already Have Insurance](#obj-have-insurance).'}
		]
	},
	{
		id: 'trg-health',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 5',
		title: 'Caller mentions a health condition',
		short: 'Health condition',
		blocks: [
			{t: 'caller', text: 'I’ve got diabetes.'},
			{t: 'warn', text: 'Don’t move past it too quickly.'},
			{t: 'note', text: 'Goal: understand if the condition is one of the reasons they’re thinking ahead.'},
			{t: 'h', text: 'Questions to ask'},
			{t: 'list', items: ['How long have you been dealing with that?', 'Has it caused any hospital stays or major concerns recently?']},
			{t: 'h', text: 'Transition'},
			{t: 'say', text: 'I imagine that’s one of the reasons you’re thinking ahead and making sure everything is taken care of for your family.'},
			{t: 'say', text: 'That makes sense. It sounds like part of the reason you’re looking into this is because you want to make sure your family is not left trying to figure everything out later.'},
			{t: 'note', text: 'Back to [Medical Questions](#medical).'}
		]
	},
	{
		id: 'trg-not-interested',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 6',
		title: 'Caller says they’re not interested',
		short: 'Not interested',
		blocks: [
			{t: 'caller', text: 'I’m not really interested.'},
			{t: 'inst', title: 'Find the real reason', body: [
				'Slow the caller down and uncover the original reason they called from the ad — without focusing on cost or free coverage.',
				'If they’re “not interested” because they thought the ad was free insurance or a benefit, handle that first with the [Free rebuttal](#obj-free), then redirect to why they reached out and whether protecting their family is still important.'
			]},
			{t: 'h', text: 'Questions to ask'},
			{t: 'say', text: 'I understand. And aside from the cost or anything you may have expected from the ad, what was it that made you call in today?'},
			{t: 'note', text: 'Or:'},
			{t: 'say', text: 'I understand. Before we even talk about cost, just so I don’t assume — what was it that made you call in today?'},
			{t: 'warn', text: 'If they still say “I thought it was free” or “I can’t afford it,” don’t get stuck on the free angle. Acknowledge it, then redirect to need, concern, and family protection.'},
			{t: 'h', text: 'Alternative follow-ups'},
			{t: 'list', items: [
				'Before we even look at whether something would fit your budget, what made you feel this was something worth checking into for your family?',
				'Aside from the cost, what was it about the ad that made you think this might be important to look into?',
				'A lot of people are careful with their budget. What were you hoping this could help protect your family from?',
				'Before we decide if it’s affordable or not, what would you want this type of coverage to take care of for your family?',
				'If cost wasn’t the main concern for a moment, what would be the reason you’d want something like this in place?',
				'Is the concern that you don’t need the coverage, or that you’re worried it may not fit your budget?'
			]},
			{t: 'h', text: 'Soft transition'},
			{t: 'say', text: 'That makes sense. The only reason I ask is because most people who call in usually saw something that made them think about their family or the cost of final expenses. I just wanted to understand what caught your attention.'}
		]
	},
	{
		id: 'trg-kids',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 7',
		title: 'Caller mentions children or grandchildren',
		short: 'Kids / grandkids',
		blocks: [
			{t: 'caller', text: 'I have three kids and six grandkids.'},
			{t: 'note', text: 'Goal: learn who they most want to protect, and connect coverage to keeping that family from carrying the burden later.'},
			{t: 'h', text: 'Follow-up questions'},
			{t: 'list', items: [
				'It sounds like family is very important to you. Who are you closest to in your family?',
				'When you think about your children or grandchildren, who would most likely be the one handling everything when that time comes?',
				'Is making sure they don’t have to deal with financial stress one of your biggest concerns?',
				'What would you want them to be able to focus on instead of worrying about funeral costs or final expenses?',
				'How would it make you feel knowing they wouldn’t have to come out of pocket for those expenses?',
				'What would you want to make sure is already handled for them?',
				'Is protecting them from that financial stress one of the reasons you decided to call in today?'
			]},
			{t: 'h', text: 'Soft transition'},
			{t: 'say', text: 'That makes sense. A lot of people who call in are not just thinking about themselves. They are thinking about the people they would leave behind and making sure things are easier for them.'},
			{t: 'note', text: 'Feeds straight into the [Beneficiary DQ](#dq-beneficiary).'}
		]
	},
	{
		id: 'trg-delay',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 8',
		title: 'Caller has been delaying the decision',
		short: 'Delaying for years',
		blocks: [
			{t: 'caller', text: 'I’ve been meaning to do this for years.'},
			{t: 'note', text: 'Goal: what made them finally act now — health, a recent loss, family responsibility, or fear of leaving expenses behind.'},
			{t: 'h', text: 'Sample questions'},
			{t: 'list', items: [
				'What made today the day you decided to finally look into it?',
				'What changed recently that made this feel more important now?',
				'When you say you’ve been meaning to do this for years, what kept you from moving forward before?',
				'Was there something that happened recently that made you start thinking about this again?',
				'What were you hoping to finally get taken care of this time?',
				'If you waited this long already, what would happen if you put it off again?',
				'Who would be most affected if this still wasn’t handled?'
			]},
			{t: 'h', text: 'Common responses'},
			{t: 'list', items: ['Health concerns → [Health Condition](#trg-health)', 'Loss of a friend or family member → [Recent Loss](#trg-loss)', 'Financial worries', 'Family responsibilities']},
			{t: 'h', text: 'Soft transition'},
			{t: 'say', text: 'That makes sense. Sometimes people put this off for years, but something eventually makes them realize it is time to get it handled. I just want to understand what made this important for you now.'}
		]
	},
	{
		id: 'trg-cremation',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 9',
		title: 'Caller only wants cremation coverage',
		short: 'Cremation only',
		blocks: [
			{t: 'caller', text: 'I just want enough for cremation.'},
			{t: 'note', text: 'Goal: understand why, and help them think through other expenses their family may still face.'},
			{t: 'say', text: 'Besides the cremation itself, have you considered other expenses your family may face, such as medical bills, transportation, memorial services, or outstanding debts?'},
			{t: 'h', text: 'Sample questions'},
			{t: 'list', items: [
				'What made you decide that cremation is the only thing you want covered?',
				'Are you mainly trying to keep the cost low, or trying to make sure your family doesn’t have to worry about anything?',
				'Besides the cremation itself, what other expenses do you think your family might have to handle?',
				'Would there be anything else you’d want taken care of, like final bills, transportation, a small memorial, or anything left behind?',
				'If the cremation was covered but there were still other expenses, who would most likely be responsible for those?',
				'How would you feel if your family still had to come out of pocket after the cremation was paid for?',
				'Would it make sense to look at an amount that covers the cremation first, then see if there is room to protect them from a little more?'
			]},
			{t: 'h', text: 'Soft transition'},
			{t: 'say', text: 'That makes sense. A lot of people call in thinking only about the cremation itself, but sometimes there are other small expenses left behind. I just want to make sure we are looking at what your family may actually need, not more than necessary.'}
		]
	},
	{
		id: 'trg-family',
		kind: 'trigger',
		group: 'triggers',
		eyebrow: 'Trigger 10',
		title: 'Caller says their family will handle it',
		short: 'Family will handle it',
		blocks: [
			{t: 'caller', text: 'My kids will take care of it.'},
			{t: 'inst', title: 'Why it matters', body: ['The goal is not to question whether their family loves them or would help — it’s to help them consider the pressure that responsibility creates.']},
			{t: 'note', text: 'Goal: acknowledge the family support, then help them weigh the financial and emotional burden their children may still face.'},
			{t: 'say', text: 'It’s wonderful that you have children willing to step up. If you had the choice, would you rather leave them a **bill** or leave them a **benefit**?'},
			{t: 'h', text: 'Sample questions'},
			{t: 'list', items: [
				'Even though they would help, would you prefer they spend that time focusing on family rather than finances?',
				'If they had to handle it, how do you think that would affect them financially?',
				'When you say your kids will take care of it, would that be easy for them, or would it put some pressure on them?',
				'Who in the family would most likely be the one handling the expenses?',
				'If you had the choice, would you rather leave them with the responsibility or leave them with something already prepared?',
				'How would it feel knowing they could grieve and be with family instead of worrying about how to pay for everything?'
			]},
			{t: 'h', text: 'Soft transition'},
			{t: 'say', text: 'That makes sense. It sounds like your children would be there for you, but the goal is really to see if we can make things easier for them instead of leaving them with one more thing to figure out.'}
		]
	},
	{
		id: 'question-bank',
		kind: 'reference',
		group: 'triggers',
		eyebrow: 'Reference',
		title: 'Emotional Discovery Questions',
		short: 'Question bank',
		blocks: [
			{t: 'h', text: 'Family-focused'},
			{t: 'list', items: [
				'Who are you ultimately protecting with this coverage?',
				'Who would be responsible for handling everything when the time comes?',
				'What concerns you most about leaving those expenses behind?',
				'How important is it to you that your family doesn’t have to worry about finances during that time?'
			]},
			{t: 'h', text: 'Experience-based'},
			{t: 'list', items: [
				'Have you ever had to help pay for a loved one’s funeral?',
				'Have you ever seen a family struggle financially after a loss?',
				'What was that experience like?',
				'What did you learn from that situation?'
			]},
			{t: 'h', text: 'Future-focused'},
			{t: 'list', items: [
				'If something happened tomorrow, would your family know exactly what to do financially?',
				'Would they have immediate access to the funds they need?',
				'How would they handle a $10,000 to $15,000 expense?'
			]},
			{t: 'h', text: 'Legacy'},
			{t: 'list', items: [
				'What kind of legacy would you like to leave behind?',
				'Is it important to you that everything is taken care of ahead of time?',
				'How would it make you feel knowing your family wouldn’t have to worry about those expenses?'
			]}
		]
	},
	{
		id: 'coaching',
		kind: 'reference',
		group: 'triggers',
		eyebrow: 'Reference',
		title: 'Coaching Notes for Agents',
		short: 'Coaching notes',
		blocks: [
			{t: 'note', text: 'Pay close attention when callers mention:'},
			{t: 'list', items: [
				'Recent loss of a spouse, parent, sibling, or friend → [Recent Loss](#trg-loss)',
				'Health concerns or hospitalizations → [Health Condition](#trg-health)',
				'Children and grandchildren → [Kids / Grandkids](#trg-kids)',
				'Living on a fixed income → [Social Security](#trg-ss)',
				'Financial struggles',
				'Existing coverage → [Has Coverage](#trg-coverage)',
				'Retirement',
				'Concerns about becoming a burden → [Don’t Burden Family](#trg-burden)'
			]},
			{t: 'say', text: 'These are emotional openings. Rather than rushing to a quote, take time to explore them.'},
			{t: 'say', text: 'The strongest Final Expense conversations are not built around insurance. They are built around family, responsibility, peace of mind, and protecting loved ones from unnecessary financial stress.'},
			{t: 'say', text: 'People rarely buy Final Expense because they want insurance. **They buy because they care about the people they will leave behind.**'}
		]
	}
];
