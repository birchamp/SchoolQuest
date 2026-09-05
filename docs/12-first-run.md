# Running SchoolQuest on your own machine, the first time

For a live test on Windows with a real OpenRouter key and real syllabi. Should take about
fifteen minutes, most of it `pnpm install`.

> **Why this and not the installer.** The `.exe` needs a deployed API to talk to, which means a
> Cloudflare account, a D1 database, an R2 bucket and a GitHub Actions run — four things that can
> each fail on their own, before the app has been tested at all. Running it locally skips every
> one of them and exercises exactly the same code. Do that first; package it afterwards.

---

## The short version

Open **PowerShell** and paste this one line:

```powershell
irm https://raw.githubusercontent.com/birchamp/SchoolQuest/main/install.ps1 | iex
```

It installs Node, Git and pnpm if you do not have them, downloads SchoolQuest, sets it up,
checks itself, puts a shortcut on your Desktop and opens the app. No administrator rights.
Safe to run again — it updates rather than failing.

Skip to [Your first term, in order](#your-first-term-in-order) once it finishes.

> **"running scripts is disabled on this system"** — Windows ships with script execution off.
> The line above handles it itself now, but if you meet that error from any other command here,
> this clears it for the current window only, and needs no administrator rights:
>
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
> ```

The rest of this page is the same thing done by hand, and what to do when a step goes wrong.

---

## What you need

Only if you are not using the one-liner above, which installs these for you.

- **Node 22 or newer** — [nodejs.org](https://nodejs.org), take the LTS installer.
- **pnpm** — after Node: `npm install -g pnpm`
- **Git** — [git-scm.com](https://git-scm.com)
- **An OpenRouter key** — [openrouter.ai/keys](https://openrouter.ai/keys). Add a few dollars of
  credit; a whole semester of syllabus reading costs about eleven cents.
- **A syllabus or two, as PDFs.** Real ones. The interesting failures only happen on real ones.

No Cloudflare account. No email provider. No admin rights.

---

## Setting up by hand

Open **PowerShell** and run these in order.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
git clone https://github.com/birchamp/SchoolQuest
cd SchoolQuest
pnpm install
pnpm run setup
```

That first line is not optional on a default Windows install, and leaving it out fails in a way
that points at the wrong thing. `pnpm` on Windows ships as `pnpm.cmd` *and* `pnpm.ps1`, and
PowerShell reaches for the `.ps1` — which Windows refuses to run, reporting an error about a file
in your Node installation. It affects `pnpm` and `npm`, not `git` or `node`. Process scope needs
no administrator rights and lasts only for that window.

Typing `pnpm.cmd` instead of `pnpm` sidesteps it too, for a one-off.

`pnpm run setup` writes `apps/api/.dev.vars` with a freshly generated `AUTH_SECRET` and creates
the local database. It is safe to run again. The `run` matters: `pnpm setup` without it is pnpm's
own command for installing itself, and it runs instead of ours without saying so.

Then check everything before you start:

```powershell
pnpm preflight
```

Every line tells you what to do if it fails. Fix anything marked `✗` and run it again — it is
much cheaper to find a busy port now than halfway through reading a syllabus.

---

## Running it

```powershell
tools\windows\SchoolQuest.cmd
```

This is what the Desktop shortcut runs, and it is the one to prefer: being a `.cmd` it goes
through `cmd.exe`, where the execution policy above is not a question at all. It checks itself
first, starts both halves, and opens your browser once they are actually answering.

`pnpm dev` does the same thing without the checks or the browser, if the execution policy is
already dealt with in that window.

Both halves start together, prefixed `[api]` and `[web]`. A cold first start takes a couple of
minutes -- `wrangler` downloads its runtime and Vite pre-bundles everything -- and prints a
heartbeat every 15 seconds while it waits, so a slow start is distinguishable from a hung one.
Ctrl-C stops both.

### A desktop shortcut, so you never type any of this again

Once, after `pnpm run setup`:

```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\create-shortcut.ps1
```

That puts **SchoolQuest** on your Desktop. Double-click it and it updates itself, checks
itself, starts both halves, and opens your browser when they are ready. Leave the black window
open while you use the app — closing it stops everything.

Updating cannot lose your work: the database and your key are both outside git, and migrations
are additive. If there is no connection, or you have edited the code yourself, it says so and
starts the copy you have. `--no-update` skips the check.

Add `-StartMenu` to also make it findable by typing "schoolquest", or `-Remove` to take the
shortcuts away again.

---

## Signing in

Type any email address — it does not need to be real, and nothing is sent.

With no mail provider configured, the sign-in link comes back **on screen** instead of by email,
and the app signs you straight in. That is deliberate: it is what makes a local run possible with
no email setup at all.

> Fine on your own machine. Do **not** put this configuration on the public internet as-is —
> without a mail provider, anyone who reaches it can sign in as anyone.

---

## Your first term, in order

The order matters, and the app now enforces the important part of it.

**1. Add your OpenRouter key.** Setup → *AI and model*. Paste the key and press Save. It is
stored encrypted and never shown again — you will see `sk-or-v1…4f2a` afterwards, which is enough
to recognise which key is stored.

While you are there, note which model reads your syllabi. The default is Grok 4.5, which is the
strongest and costs about eleven cents for a five-course semester. The cheaper options are listed
with their prices.

**2. Build the semester calendar.** Setup → *Semester calendar*. Term start and end, then paste
your school's academic calendar page — the one listing breaks and finals week.

**This is required before you can upload anything.** A syllabus does not contain a calendar, it
*points* at one: "Week 14", "each Tuesday in class", "finals week". Read against an empty
calendar those do not fail loudly — they produce a date, silently, off by however much the guess
was wrong. The upload control stays disabled until the calendar exists.

**3. Add your courses.** Name and code. The code is what the app matches against the syllabus.

**4. Upload a syllabus.** The PDF is read in your browser, page text goes to the model, and the
claims come back for review.

**5. Review what it found.** This is the part worth watching. Every claim carries the page and
the exact line it came from. Anything the app could not settle appears as a question rather than
a guess — which weekday quizzes are due, which of two dates is the real one, what a placeholder
in the schedule means.

**6. Answer the effort survey**, and check *Still unanswered* — it collects everything nobody has
answered across all your courses, with a message drafted per course that you can send your
instructor.

---

## What to watch for, and what to write down

You are the first person to run this against a real model on a real syllabus. Everything before
now used a recorded stand-in, so the model's own reading has never actually been tested.

Worth noting as you go:

- **Dates that are wrong rather than missing.** A missing date is visible and asked about; a
  confidently wrong one is the failure that matters. Check anything dated by "Week N" hardest.
- **Work that is missing entirely.** Compare the assignment list against the syllabus. Recurring
  work stated as a rule ("a response each Tuesday") is where things have historically vanished.
- **Questions that read oddly**, especially in the drafted instructor message. That copy is new.
- **Anything on the plan for the first week that obviously should not be.** Undated work is now
  spread across the term rather than raced to the front, and that change is recent.

`docs/10-syllabus-gotchas.md` is the running log of everything real syllabi have done so far. If
you hit something not in it, that is a genuinely new one.

---

## When something goes wrong

| What you see | What it is |
| --- | --- |
| `pnpm: command not found` | pnpm is not installed: `npm install -g pnpm`, then open a **new** PowerShell |
| `pnpm.ps1` or `npm.ps1` `cannot be loaded because running scripts is disabled` | Windows' execution policy, not a broken Node. `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`, or type `pnpm.cmd` instead of `pnpm`. |
| It says `still starting` for a couple of minutes | Normal on a first run. It gives up at three minutes and names the half that never arrived. |
| `install.ps1` said "not recognized" partway | winget updates PATH for new windows only. Close PowerShell, open a new one, run it again. |
| `npm.ps1 … cannot be loaded because running scripts is disabled` | Windows' execution policy. `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`, then run the one-liner again. |
| The page loads but everything errors | The API is not running. Look at the `[api]` lines in the terminal. |
| Port 8787 or 5173 in use | An earlier run is still going: `netstat -ano \| findstr :8787` then `taskkill /pid <pid> /f` |
| "No OpenRouter key is set" | Setup → AI and model |
| Upload is greyed out | The semester calendar is not filled in yet — step 2 |
| `no such table: users` | Migrations did not run: `pnpm run setup` |
| Sign-in does nothing | `AUTH_SECRET` is missing. Delete `apps/api/.dev.vars` and run `pnpm run setup`. |

The terminal running `pnpm dev` prefixes every line with `[api]` or `[web]`, so it is clear which
half is complaining. That output is the most useful thing to keep if something needs reporting.
