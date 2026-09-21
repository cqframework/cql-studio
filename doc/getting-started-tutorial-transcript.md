_Approximately ~15 minute voiceover with screen recording._

## Introduction & Foundry Deploy

Welcome to this CQL Studio quick start tutorial for the v3 release, where we'll get you up and running CQL Studio on your local computer using the pre-built official distribution. The website is simply cqlstudio.com where you'll find more info and GitHub links to the source code for contributions and issues. So, CQL Studio is an integrated suite for developing, testing, and publishing standards-based CQL artifacts using the FHIR data model.

You can import and export FHIR packages, author and edit CQL libraries, test them against your own FHIR data, browse and validate terminology, run engine compatibility tests and a whole lot more. CQL Studio can be deployed in many ways, from locally on your computer to a shared team environment in public or private clouds. This specific tutorial is going to focus on deploying to a local computer, but the same general workflows apply to other hosted environments, such as HL7's shared instance at https://studio.quality.hl7.org.

Certain areas are optional or configurable by the operator. Direct VSAC integration for users in the U.S., as well as generally available AI integration, are a few features may be visible but need user configuration configure before use.

We'll be using the official Evergreen distribution published to HL7 Foundry at foundry.hl7.org which is targeted to local CQL users and developers wanting to run CQL Studio on a local laptop or desktop machine. And this distribution is tested to deploy out of the box via Docker Desktop.

So if you don't have Docker Desktop installed, do that now. Generally speaking, we try to make things work with Podman Desktop as well. If you have a preference for that or licensing issues.

Anyway, the Evergreen distribution in HL7 Foundry is always going to use the latest versions of all components. So expect things to change. But the general architectural and deployment concepts will still apply.

You'll need to be logged into Foundry up here in the top right corner with your free HL7 account. Go ahead and search for CQL Studio. And you might see a couple underlying component products pop up in the results list depending on your account .

That's okay. The one you want is the complete bundle, which is just labeled CQL Studio. If I click that, you'll get some basic information about what's included with the package. 

If you're curious on what's inside, you can click through to the bundled products tab, but the configuration wizard tab is where you want to go and select the current latest build with the default configuration. This should all pop up as default values for you. Click the "Download All" button to download a .zip file of required files, and then click the "Docker" button to download the runtime file for Docker Desktop.

And on your local computer, unzip that zip file. You can put the folder wherever you would like, and put that Docker file into the directory as well. So you should have one directory with all the files in it.

Then you can hop back over over to the Foundry instructions and copy this command, which will allow you open terminal in that the directory you created, paste it in and hit enter to start everything.

And what is going to happen now is it'll download all the current versions of all of the software images from the official repositories and start those up. v3 and later requires user authentication, even if you're the sole user, so authentication system now ships with all official distributions.

I've fast forwarded the video since it'll take a few minutes, and everything seems to have spun up.

At this point, I'll open the Foundry instructions and open the CQL Studio UI link in a new browser tab. The default username is administrator@localhost and the password is just the word "password" in all lower case. You'll be redirected back to CQL Studio which you now have set up and running on your local computer!

## Settings

CQL Studio v3 stores most user settings in a database. If you're upgrading from a version prior to v3, you'll need to go to Settings and reenter anything needed. If you're using a hosted instance, you should consider whether you trust the operator before entering anything sensitive.

v2.4 and later introduced the concept of environmental profiles, and every distribution has a "default" profile that is supposed to work out of the box, and cannot be changed. The downloadable Foundry distribution automatically use a single HAPI FHIR server for anything and everything related to FHIR resource storage and CQL execution. You can create other profiles that use multiple servers for different purposes, depending on your needs.

You'll find a variety of settings to mess with, but U.S. users will likely want to enter their VSAC API key for searching and importing from the national Value Set Authority Center. There's a dedicate VSAC screen for search and import, and when this is enabled with additional AI support, AI agents will be able to research and, import, and edit value sets per your prompt instructions.

If you would like to enable AI you'll need an Ollama endpoint accessible via network. You can use Ollama to either run a local model, such as qwen3.8 which we're using for CQL Studio 3.0 release as a recommended LLM, or as a proxy to other AI providers. You'll have to set that part up yourself and provide the connection info to CQL Studio.

## FHIR Uploader and Running "Hello, World"

The FHIR uploader under the Tools menu allows you to upload your own arbitrary FHIR packages, your own FHIR Bundles in JSON format, as well as raw CQL text files that haven't been encoded a FHIR yet. The best way to get started with CQL Studio is to use this **Add Built-In Examples** button right here. That's going to add a few small synthetic data files that come bundled with CQL Studio as well as a Hello, World CQL code example in one step.

If you later bring your own Synthea FHIR data, note that Synthea-produced files have to be uploaded in a certain order. There's a **Reorder Synthea Dependencies** button that does this automatically, as well as controls to manually change file order. For this tutorial though we'll stick to the built-in examples. Now click **Upload Bundles** which should be fairly fast to load.

If you have developer mode enabled, you'll also see a **Danger Zone** section at the bottom with the ability to send a data wipe command to your server. That data wipe is irreversible, so it's hidden by default.

Before we leave the uploader, let's quickly run the HelloWorld example we just loaded. We'll **Authoring ->  CQL IDE**, open the HelloWorld library from the server, search and select one of the bundled sample patients under the "Context" section, and click **Execute**. You should see expression results in the Console, which is enough to confirm the stack is working end to end. We'll come back to the IDE a bit later for a fuller walkthrough of panels, clipboard insert, and AI etc, but for now this is just a smoke check after upload and get you started actually running CQL!


## VSAC Browser, Cartos Browser, Terminology Browser, and Clipboard

U.S. users with a VSAC API key will be able to use the Tools -> VSAC Browser screen. This allows for freetext search, recursive dependency analysis, and full value set expansion from VSAC when allowed by the server. The import buttons provide one-step import into the local server, or the terminology server configured in the active environment profile.

Tools -> Cartos Browser provides similar find-and-import workflows against ONC’s public Cartos FHIR terminology service (Certification / SVAP / IG value sets). No API key is required; Cartos is for design-time discovery and import only, not production runtime lookups.

The terminology browser operates on the terminology system in your enviroment profile. It's not intended to be a full terminology authoring and management sytem, but more of a quick way to locate value sets or codings stored on it and then add their references to the clipboard using this button right here. Items in the app clipboard are then available to the IDE and elsewhere.

The Tools -> Clipboard Manager screen is a temporary space to keep FHIR objects you're currently working on. And if you have AI services set up, the clipboard content will also be available to it to provide working context for the prompts you provide. When using environment profiles, note that the Clipboard Manager's search interface only querying your FHIR data endpoint, not your terminology endpoint.

## Learning Example Library

Under **Learning -> Examples** you'll find curated, complex, real-world demo packages that go far beyond Hello, World, including value sets and example patient data. To import the Lipid Management example package, just click the "Open in FHIR Registry Importer" button and then click "Import Selected" with the default settings. We'll loook at this in the IDE, next.

## CQL IDE Overview

The CQL IDE under the Authoring menu is the centerpiece of CQL Studio. You can open and edit existing libraries, create new ones, and of course run them using data stored on your FHIR server. There's full support for syntax highlighting, with a Problems view that identifies syntax errors and provides diagnostics.

The Outline view is a navigational aid for large libraries, and the Console view shows the output of CQL execution.

New to CQL Studio v3 is editor context menus. "Find All References" opens a dedicated References viewer, and the Rename tool  helps with find/replace operations.

Most notably, value sets have special menu options such as "Peek". When you peek a value set that's expandable, the Peek viewer shows a searchable list of it's entire contents. You can also open value sets directly from the editor in the Terminology Browser.

The Clipboard viewer also you to quickly insert terminology or other references from the app clipboard we saw earlier, and is handy for making sure that you get the right URLs and useful names for things.

## CQL IDE AI Tab

The IDE's AI tab is a major work area of for CQL Studio v3, particularly using local, open weight models. While you can use external AI providers, the downloadable distribution will focus on models you can run on high-end laptops without needing to send data or IP outside of your nework. This example using a qwen3.8 model taking around 19GB of memory that's been optimized for Apple Silicon and is running on a dedicated M3 Ultra chip over a local network. While the performance local models is not comparable to commercial models as of 2026, it is still remarkably useful, especially in library drafting and troubleshooting stages.

v3.0 includes a new architectural component specifically for maintaining AI session state, and permits one AI session per user at time. In subsequent releases this will expand to integrate with the Team -> Workspaces section, but in v3.0 at least all open editors are automatically synced to this AI session.

You can also include PDFs, word documents, CSV, and other common files types, which will be converted to Markdown internally. Let's run AI examples of increasing complexity, restarting a new session between each one and editing out the wait times.

### AI: Explain

When looking at a complicated example such as LipidManagement, it's hard to understand what's going on. We can see it's using a number of other underlying CQL libraries, but it's thousands of lines of logic. Let's open each file to add it to the session context, and then ask for an explaination.

The LLM analyzed the text, and gave us a basic breakdown of what's going on and how it's organizaed.

### AI: Debugging

It's easy to make CQL syntax errors, and the Problems view doesn't always tell you how to actually fix the issue. As a simple example, let's intentionally corrupt our LipidManagement library by using uppercase letters in the "include" statements. The Problems view says there's a "Syntax error" but it may not be obvious it's a case issue. Let's ask the AI model to "Fix the syntax error" and come back in a minute.

Our local model figured out it's a case sensitivity  issue, and that this is causing the cascade of other errors in the Problems view. It then applied the fix in the local editor in an unsaved state, along with providing buttons to revert the changes.

### AI: Drafting

The most complex AI integration cases are fully AI-driven CQL library development. To demonstrate this I'm using a 4-page clinical guideline document provided as a .pdf file, written in clinical language and including a decision table on the last page. To reduce convertions, we suggest converting to Markdown or plaintext format first to fix any issues, which I've also done in this case. I'm going to create a new, empty library, start a new AI session, attach my documentation, and ask it to "Draft a set of expressions implementing the guideline decision tiers", then go get a cup of coffee.

You can see the turn-based agent iterating through different ideas, until finally settling on what is presented. We can now test the CQL Library using patients we imported earlier, and even build a SMART-on-FHIR app on top of it using the CQL with FHIR implementation guide.

## FHIR Export Wizard

When you have a library in good shape, you probably want to send it somewhere. The **Tools -> Export Wizard** areas allows you to download raw FHIR resources, create valid FHIR NPM packages that can be published to a registry or imported by other systems, or run a server-to-server copy to another environment you have saved as an environment profile.

For this demo I'll choose "FHIR NPM package". On the Libraries step, I'll search for and select `LipidManagement` as what I want to export. Then I'm going to skip the Data step because I don't want to include any example data. The Dependencies step will then do a recursive static analysis of the CQL library and value sets, and present a flattened list of everything that needs to be included for the recipient to be able to run it. In our case, this included the underlying resources like the `OpenCVDRisk` and `BMI` CQL libraries, and all the ValueSets that they reference. We'll go to the next step, provide a package name and Author, and download the completed package for our production environment. These packages can also be imported by other instances of CQL Studio.


## Engine Test Runner

Lastly, let's look at CQL engine testing. Not Library logic testing, but validating the behavior of CQL engines themselves. The Testing -> Test Runner screen provides a UI for the official CQL engine  compatibility testing suite part of the CQFramework set of repositories on GitHub.

This quick test option is a quick smoke testing to make sure everything's running correctly.

## Engine Test Results

In addition to the engine testing tool, CQL Studio ships with the most recent copy of vendor-submitted results reports.

If you go to Testing -> Tests Results, select the Example index, then the Summary Dashboard option, you're going to see cross-compatibility matrix of all engine data currently known to CQL Studio.

## Closing

That'll wrap this Getting Started video. We'd love to get your creative feature requests, bug reports, learning library examples, and other contributions via the GitHub repository "issues" page at github.com/cqframework/cql-studio. 

In addition, the FHIR Zulip chat system is also a good place for discussion. Thanks for watching and let us know what you've built with CQL Studio and you could be the next featured project.


