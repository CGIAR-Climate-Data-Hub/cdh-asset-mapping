# Feedback pipeline — Microsoft Form → GitHub Issues

Reviewers (centre focal points, leadership) give feedback through a **Microsoft
Form** — no GitHub account required — and every response is filed automatically
as a **GitHub issue** in this repository, so nothing is lost and each item is
triaged to resolution.

```
Reviewer → Microsoft Form → Power Automate flow → GitHub issue (labelled, triaged)
```

This is the M365-native pathway (CGIAR runs Microsoft 365), built with no code.

---

## 1. Create the Microsoft Form

Create a form (forms.office.com) titled e.g. *"CDH Asset Mapping — feedback"*
with these questions (keep field names stable; the flow maps them):

| # | Question | Type | Notes |
|---|---|---|---|
| 1 | Feedback type | Choice | `Correct a record` · `Suggest a missing asset` · `General feedback` |
| 2 | Asset name | Text | optional for general feedback |
| 3 | Centre / owner | Text | optional |
| 4 | Details | Long text | what's wrong + correct value, or why the asset matters, or the comment |
| 5 | Source / link | Text | optional evidence or URL |
| 6 | Your name & email | Text | optional, for follow-up |

Publish it and copy the share URL.

## 2. Wire the URL into the report

Set `FEEDBACK_FORM_URL` near the top of `src/report_common.py` to the form URL,
then re-render. The report's **Feedback** section will show the form button.

## 3. Power Automate flow (Form → GitHub issue)

In Power Automate (make.powerautomate.com), create an **automated cloud flow**:

1. **Trigger:** *Microsoft Forms — When a new response is submitted* (select the form).
2. **Action:** *Microsoft Forms — Get response details* (Response Id from the trigger).
3. **Action:** *GitHub — Create an issue* (the GitHub connector; authenticate once
   with an account that can write issues to this repo). Map:
   - **Repository owner:** `CGIAR-Climate-Data-Hub`
   - **Repository:** `cdh-asset-mapping`
   - **Issue title:** `[forms] ` + *Feedback type* + ` — ` + *Asset name*
   - **Issue body:**
     ```
     Submitted via the feedback form.

     Type: <Feedback type>
     Asset: <Asset name>
     Centre: <Centre / owner>
     Source: <Source / link>
     From: <Your name & email>

     Details:
     <Details>
     ```
   - **Labels:** map *Feedback type* → `correction` / `new-asset` / `feedback`
     (use a Switch on *Feedback type*, or set a single `from-form` label to start).

That's it — submissions now appear as labelled issues.

### Optional hardening
- Add a Switch step to apply the matching label per feedback type.
- Add an Outlook/Teams "notify the data team" step in parallel.
- De-duplicate by including the Forms Response Id in the issue body.

## Alternative (no Power Automate)

If Power Automate is unavailable, export the Form's responses workbook
(SharePoint/Excel) and run a small GitHub Action on a schedule that reads new
rows and calls the GitHub REST API (`POST /issues`). Power Automate is preferred
because it is real-time, codeless, and already part of the M365 tenant.

## Why this design

- **Reach:** reviewers need no GitHub account — the biggest barrier for centre
  focal points and leadership.
- **Tracked:** everything still lands as a triageable, assignable, labelled
  GitHub issue — the single source of truth for the dev/data team.
- **No new infrastructure:** Forms + Power Automate are already in the tenant.

GitHub-comfortable contributors can still open a pre-filled issue directly via
the links in the report's Feedback section.
