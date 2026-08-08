# Installing SchoolQuest on Windows

This page is for the person installing the app, not for the person building it. If you are
setting up releases, see [`apps/desktop/README.md`](../apps/desktop/README.md) instead.

It should take about three minutes. You do not need an administrator password, and you do not
need to know what any of this does.

---

## 1. Download it

Go to the SchoolQuest **Releases** page and download the file whose name ends in
**`-setup.exe`** — it will look like `SchoolQuest_0.1.0_x64-setup.exe`.

There is also a `.msi` file. Ignore it. That one is for university IT staff installing the app
onto many machines at once, and it asks for an administrator password.

## 2. Open it

Double-click the file you downloaded. It is usually in your **Downloads** folder, and Chrome and
Edge also show it at the bottom of the window or under the download arrow.

## 3. If Windows says "Windows protected your PC"

You will probably see a blue box that says **Windows protected your PC** and only offers a
**Don't run** button.

1. Click the small **More info** link in the box.
2. A **Run anyway** button appears. Click it.

This warning is not about a virus. Windows shows it for any program that has not been signed with
a paid certificate, which SchoolQuest has not been yet. It goes away for everyone once the project
buys one. If you would rather not click past it, use SchoolQuest in your web browser instead —
everything except dragging in syllabus PDFs works exactly the same there.

## 4. Let it install

The installer runs on its own. It installs SchoolQuest **for your account only**, so it never asks
for an administrator password, which matters if your laptop is managed by your school.

If your computer has never run a Microsoft Edge–based app before, the installer downloads a small
Microsoft component called **WebView2** first. You need to be online for that, and it only happens
once.

When it finishes, SchoolQuest opens by itself. It is also in your Start menu from then on — press
the Windows key and type `SchoolQuest`.

---

## 5. Signing in

SchoolQuest has no password. You give it your email address and it sends you a link.

1. Type your email address and click **Email me a sign-in link**.
2. Open the email. It arrives within a minute; check your spam folder if it does not.
3. **Do not click the link.** Right-click it and choose **Copy link** (Outlook and Gmail both call
   it that).
4. Go back to the SchoolQuest window and paste the link into the box that says
   *Paste your sign-in link here*, then click **Sign in**.

The reason for the copy-and-paste is that clicking the link opens your web browser, and that signs
you in to the browser rather than to the app you just installed. The app cannot see what happens
in the browser, so it would sit there waiting.

You stay signed in for two months, so this is a once-a-semester annoyance rather than a daily one.

The link stops working 15 minutes after it is sent, and it only works once. If you get *"That
sign-in link has expired or was already used"*, go back and ask for a new one.

## 6. What you do first

The app asks for your term dates and your classes, then for a syllabus for each class. You can
drag the PDFs straight onto the window. That first setup is the longest part of using
SchoolQuest — it is also the only part you do more than once a semester.

---

## If something goes wrong

**"SchoolQuest cannot reach its server."** You are offline, or the server is briefly down.
SchoolQuest needs an internet connection: it does not work on a plane. Check your wifi and click
**Try again**. If it keeps happening and your connection is fine, the screen names the server it
is trying to reach — include that when you ask for help.

**"This copy of SchoolQuest is missing its server address."** The installer itself was built
wrong. Nothing you can do on your machine will fix it; download the installer again from the
Releases page, and if it still happens, report it.

**Nothing happens when you double-click the downloaded file.** Some browsers block `.exe`
downloads. Look for a "keep" or "keep anyway" option in your browser's downloads list, and
download it again.

**It says a newer version is already installed.** You already have SchoolQuest. Open it from the
Start menu.

## Uninstalling

Press the Windows key, type `Add or remove programs`, find **SchoolQuest** in the list, and click
**Uninstall**. It does not need an administrator password, and it does not delete your account —
your plan, courses and syllabi live on the server, so signing in again anywhere brings them back.
