# Essential Prompts Documentation

This document contains key prompts used during the development of the Personal Productivity Assistant.

---

## AI Model Prompts for Workers AI

### 1. Natural Language Task Parser
**Model**: `@cf/meta/llama-3-8b-instruct` (or similar LLM)

## Project Progress (updated)
- Worker CRUD endpoints (`/api/tasks` GET/POST/PUT/DELETE) backed by D1.
- Durable Object `CommandParserDO` added for NL parsing context/history.
- AI endpoints deployed:
  - `/api/ai/parse-task` (DO + Workers AI)
  - `/api/ai/suggest-priority`
  - `/api/ai/estimate-duration`
  - `/api/ai/categorize-task`
- Frontend wired to Worker via `taskService`; inline edit/delete updates backend.
- Tests in Vitest cover service calls and TaskTable edit/delete flow.

# Prompt snippets for development


The website that I want  to design is a personal productivity assistant with a task management system and potentially, a calendar later. 

For this particular project, I need to use Durable Objects with Worker and integrate Workers AI into it. That is the number 1 priority. Give me 3-5 ideas for features in this personal productivity assistant that would require Durable Objects and the preference is if it is specific to the task management system and not a fresh feature, although ideas for that may be explored as well. I think maybe the following couple of ideas may be something I'm leaning into:
1. Daily Schedule Coordinator

A Durable Object that maintains the "current day's schedule"
Handles time slot conflicts when rescheduling
Coordinates between AI suggestions and user preferences
2. Task Analytics & Insights Engine

Tracks task completion patterns, time estimates vs actuals
Aggregates data for AI to learn user behavior
Provides personalized productivity insights

3.  I think that a natural language command parser would also be a great usage of durable objects and if that is sufficient, that is fine.

The workers AI features that I want to implement and have seen from some recommendations are as follows:

1. Convert a natural language task which is written into the format of a task based on the details given
- Analyze information from the input to discern what the task is, and every other field in the schema like priority, deadline etc.

2. **Smart Priority Suggestion** (using LLM)
   - Endpoint: `/api/ai/suggest-priority`
   - Analyze task title, due date, and description to recommend priority
   - Use case: Auto-set priority when creating tasks

3. **Time Estimation** (using LLM)
   - Endpoint: `/api/ai/estimate-duration`
   - Estimate how long a task will take based on description
   - Use case: Help users plan their day realistically

4. **Task Categorization** (using LLM or `@cf/huggingface/distilbert-sst-2-int8`)
   - Endpoint: `/api/ai/categorize-task`
   - Auto-tag tasks as "Work", "Personal", "Study", "Health", etc.
   - Use case: Automatic task organization

Website Design:
The design of the website should be as follows: 

Navbar: 
A dark blue navbar at the top with the name of the wesbite at the left corner. The following buttons on the right side of the navbar(listed left to right): 
1. Create Task(redirects to /tasks page), 
2. "View Tasks"(this redirects to a page which shows directly what was added to the db.) 

Home Page:
The home page of the website(/) should have the following:
1. A search bar-like form input where the user would write in natural language and it could be converted to the format of a task(JSON). 
2.  Below that, there should be a view of the database, where we see the entries of all the tasks
3. We should have two buttons, one for "assign priority", and "one for categorize tasks", where those can be applied to categorize all the selected tasks based on an LLM call.

Tasks page: /tasks . This is where we will create a task
This is a rough idea for the website.

I do not want to implement all of this immediately. Design a sequence of prompts to design this personal productivity assistant and help me execute them step by step. Allow me to refine at each step while maintaining . Provide me with inputs. Do not build anything immediately.

Additionally, I want to maintain a PROMPTS.md for this where I keep some essential prompts from this project documented. 

Also, define the file structure that would be required for this entire project. Think about any files that may be required for any use cases based on how I have defined it for some of the use cases. Document the structure in one MarkDown file.

## Second prompt

okay couple of notes,
1. I want to add a field to Tasks. Basically, I want something called "Note" which is a field which should be visible in any database view and should be editable easily at any point when I'm viewing the database of tasks. Every field should be editable when you are looking at a view honestly. Every row in a db view should be editable as a whole, let me know if you understand this sentence. You should not add a Note when using the natural language parser, you should only be able to add a note in the "Create Task" section. 

2. Let's prioritize the first three steps in the implementation sequence: 1. Foundation (DB + Basic CRUD), 2. Natural Language Parser (First DO + AI), 3. Task Intelligence (AI features) which has the basic features using workers AI. These three steps must be implemented perfectly in a clean manner, with object oriented principles such that any future extension of these modules is easy. Let's focus on steps 4 and 5 at a later stage and not until the first 3 steps are complete. What exactly are the features included in Task Intelligence? One additional note about categories in the task categorizer, the categories are, Work, Personal and Other. Personal contains Health, Social, finance, Chores. Work contains Courses, Internship, Projects. Other is a category on it's own.

3. To begin the project, I want to make sure that some fundamental components of the front end are present. I would like to design the navbar described in the previous prompt. Use Tailwind CSS for all style components, including the NavBar, and describe what you have used briefly in the chat as well. 
Additionally, on the home page, temporarily add a welcome message on the Home page.
Immediately after we redesign the home page so we can define a basic theme for how the website would look, we'll integrate the D1 database.

4. Don't create excessive MarkDown files explaining things, keep it as minimal as possible with one information document for explanations. Deployment instructions must be added to the original README.md only, we do not need a DEPLOYMENT.md file separately.

5. Let's ensure that testing has some importance. We should write some unit tests for any essential component that we can write tests for so we can check what is breaking at any point. As we start building more workers AI integrations, we can write tests for that as well, but carefully because we don't want to exhaust our possible API usage for workers AI.

Third prompt:

Just as a clarification, all these changes are happening in the cf_ai_personal_productivity_assistant
Answers to questions:

1. I've changed my mind, lets make the NavBar dark grey and make the rest of the home page an appropriate colour. 

2. The "View Tasks" will contain the same database view as the home page where you can edit the tasks you have. We can also include all the buttons that have the AI features in this page.

3. Note field can be null, it is a text area and I haven't thought of a character limit but let's say 200.

4. I've used Vitest briefly, which is the standard?
5. After the Navbar, let me give any notes on the design of the NavBar/home page and we can go from there. The first step would be to make an aesthetic looking form for the Create Table using Tailwind CSS. The submit button need not push to the database immediately, we can integrate that later. This create table does not require tests immediately as the database is not yet integrated.
As soon as I have approved the table, let's move on to integrating the D1 database and proceed with feedback from there.

Let us begin the D1 database integration. Include every table that may be required for future workers AI integration as well and as discussed in the previous prompts and prompt answers which had the requirements description. Now, let's add a database view in the home page and add the routing for the "View Tasks" Button as well to a page where the tasks are all available.

We need to continue with the next steps in the implementation. Updates since last: repository and local dir. name has been changed to cf_ai_eris
Next steps:

The next steps earlier mentioned are as follows
Add worker config and binding: create worker/wrangler.toml with D1 binding DB and AI binding AI. - This is done I think, but we can verify.
Apply migration: place 0001_initial.sql under worker/db/migrations, run wrangler d1 migrations apply.
Implement Worker API: worker/src/index.ts with CRUD routes for tasks; hook to D1; include CORS.
Connect frontend: create app/src/services/taskService.ts to call Worker endpoints; wire Home/ViewTasks tables to live data; add optimistic updates for inline edits (including Note).
Add basic tests: Vitest for taskService request shaping and table edit logic (mock fetch).