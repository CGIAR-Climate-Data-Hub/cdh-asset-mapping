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

## 3. Power Automate flow (Form → GitHub issue) — click by click

This builds the flow that turns every form response into a GitHub issue. One
time, ~10 minutes. You need: the form from step 1, and a GitHub account that
can open issues in this repo.

### 3.0 First, create the three labels (once)

In GitHub: open `https://github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping/labels`
→ **New label** → create each of these (name must match exactly):

- `correction`
- `new-asset`
- `feedback`

### 3.1 Create the flow

1. Go to **https://make.powerautomate.com** and sign in with the same work account.
2. Left sidebar → **Create**.
3. Choose **Automated cloud flow**.
4. **Flow name:** `CDH feedback to GitHub issue`.
5. In **Choose your flow's trigger**, search `Forms`, pick
   **Microsoft Forms — When a new response is submitted**. Click **Create**.

### 3.2 Trigger — pick the form

6. In the trigger card, click the **Form Id** box → select
   **CDH Asset Mapping — feedback** from the dropdown.

### 3.3 Get the answers

7. Click **+ New step**.
8. Search `Forms` → choose **Microsoft Forms — Get response details**.
9. **Form Id:** select **CDH Asset Mapping — feedback** again.
10. Click the **Response Id** box → in the dynamic-content panel that opens,
    pick **Response Id** (from the trigger "When a new response is submitted").

### 3.4 Create the GitHub issue

11. Click **+ New step**.
12. Search `GitHub` → choose **GitHub — Create an issue**.
13. First use only: click **Sign in**, authorise the GitHub account.
14. Fill the fields (use the dynamic-content panel to insert the bracketed
    items — they appear under **Get response details**; their names match your
    form questions):
    - **Repository owner:** `CGIAR-Climate-Data-Hub`
    - **Repository name:** `cdh-asset-mapping`
    - **Issue title:** type `[form] `, then insert **What kind of feedback is
      this?**, type ` — `, then insert **Asset name (if about a specific
      asset)**.
      Result looks like: `[form] Correct a record — AClimatic rainfall layer`
    - **Issue body:** paste the template below, then replace each `«…»`
      placeholder by inserting the matching dynamic-content item (delete the
      `«…»` text, leave the label before it):
      ```
      Submitted via the feedback form.

      Type: «What kind of feedback is this?»
      Asset: «Asset name (if about a specific asset)»
      Centre: «Centre / owner»
      Source: «Source or link (evidence / URL)»
      From: «Your name & email (for follow-up)»

      Details:
      «Details — what's wrong + the correct value, or why the asset matters, or your question»
      ```

### 3.5 (Optional) label per feedback type

Without this step, issues get no label. To auto-label:

15. **Between** "Get response details" and "Create an issue", click **+ New
    step** → search `Control` → choose **Switch**.
16. **On:** insert **What kind of feedback is this?** (dynamic content).
17. Add three cases (**+ Add** → **Add case**), Equals these exact values:
    - `Correct a record`
    - `Suggest a missing asset`
    - `General feedback / question`
18. Move the **Create an issue** step inside the matching case (or duplicate
    it per case), and in each set **Labels** → the matching label:
    `correction` / `new-asset` / `feedback`.

    Simpler start: skip the Switch, and in **Create an issue** set **Labels**
    to a single `feedback` for everything; add the Switch later.

### 3.6 Save and test

19. Top right → **Save**.
20. Open the form's public link, submit a test response.
21. Back in Power Automate → the flow's **Run history** should show a green
    success within ~1 minute, and a new issue appears in the repo. Close the
    test issue.

That's it — submissions now appear as issues, labelled by type.

### Optional hardening
- **Notify the data team:** add an **Outlook — Send an email** or
  **Teams — Post message** step in parallel with "Create an issue".
- **De-duplicate / trace:** add `Response Id: «Response Id»` to the issue body
  so each issue maps back to one form submission.

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
