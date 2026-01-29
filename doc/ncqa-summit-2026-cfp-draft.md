# NCQA Health Innovation Summit 2026 – CQL Studio Submission Draft

**Event:** [Health Innovation Summit 2026](https://www.ncqa.org/events/health-innovation-summit-2026/) (Atlanta, Georgia)  
**Context:** NCQA Summit draws 1,500+ attendees and focuses on healthcare quality; digital quality, HEDIS, and interoperability are core themes.

Use this content to complete the NCQA proposal form. Fill in speaker details and any theme/track options as required by the form.

---

## Session Title

**85 characters including spaces or less.**

**Building a FHIR-Native CQL Authoring Experience: Lessons from CQL Studio**

*(Character count: 58)*

---

## Session Description

**600 words, paragraph form, 3–5 sentences per paragraph. Avoid abbreviations.**

**Your response must include:** the performance opportunity or population need; the goal or purpose of the intervention; any regulatory or operational implications; practical examples or scenarios; considerations and trade-offs; the logic behind key decisions; how stakeholders contributed; the expected benefits for beneficiaries.

---

Health plans and measure developers face a growing performance opportunity and population need: digital quality measurement. The National Committee for Quality Assurance (NCQA) and the industry are moving toward digital HEDIS and electronic clinical data, with measures specified in Clinical Quality Language (CQL) and Fast Healthcare Interoperability Resources (FHIR). Many organizations still author and test CQL using a mix of local tools, spreadsheets, and manual steps, which slows development, increases errors, and makes it harder to validate measure logic against real data and official engine behavior. This session addresses that gap by sharing the implementation journey and lessons learned from building CQL Studio, an open-source web application that provides an integrated environment for developing, testing, and publishing CQL and FHIR-based artifacts, including those used in digital quality and measure certification workflows.

The goal of the intervention was to deliver a single, browser-based workflow where implementers can write CQL, bind to FHIR value sets and code systems from terminology servers (such as the Value Set Authority Center), run measure logic against FHIR data via standard Library operations, and execute and analyze results from the official CQL engine compatibility test suite. We wanted the tool to speak natively to FHIR terminology and data services so that health information technology (IT) and quality teams could reduce context-switching and integrate authoring, terminology lookup, execution, and testing in one place. From a regulatory and operational perspective, the work supports the transition to digital HEDIS and electronic clinical data systems reporting. Reliable, testable CQL that runs against FHIR endpoints is foundational for measure certification, hybrid measure transitions, and interoperable quality reporting. The session will describe how the design choices in CQL Studio support these use cases and what organizations should consider when adopting or adapting similar tooling.

Practical examples and scenarios will illustrate the intervention. We will walk through using CQL Studio to search and browse value sets and code systems from a FHIR terminology server, attach them to CQL logic, and run that logic against a configured FHIR data endpoint using the Library resource’s standard evaluate and CQL operations. We will show how the integrated test runner drives the official CQL engine compatibility suite and how results are analyzed with filtering, sorting, and cross-engine comparison, so that measure developers and health plans can validate behavior before production. We will also touch on deployment via Docker and configuration of terminology and FHIR server base addresses so that different environments (development, testing, production) can be supported without code changes.

Considerations and trade-offs we encountered included the decision to build a web-based application rather than a desktop tool. We chose the browser for accessibility, deployment simplicity, and the ability to run the same experience on any machine without installation. The trade-off was managing browser constraints (for example, cross-origin and terminology server access) and ensuring that sensitive data stays under the organization’s control by pointing the tool at their own FHIR and terminology endpoints. We also had to balance feature breadth with maintainability: we focused on FHIR R4, standard terminology service application programming interfaces (APIs), and the Library operations that align with current digital measure execution, rather than supporting every possible extension. The logic behind these decisions was interoperability first: by relying on published FHIR and CQL standards, the tool can work with any compliant server and remain useful as NCQA and the industry evolve digital measure specifications.

Stakeholders and collaborators were essential. CQL Studio lives in the same open-source ecosystem as the official CQL tests and translation libraries (the CQFramework family). Engagement with measure developers, health plan IT staff, and implementers who use CQL for digital quality and HEDIS informed which workflows to prioritize and which terminology and execution patterns to support. Their feedback shaped the integration with FHIR terminology services, the design of the test runner interface, and the decision to make the application Docker-ready for consistent deployment across organizations. Expected benefits for beneficiaries include more reliable and consistently tested quality measures, faster iteration for measure developers, and a lower barrier to interoperable digital quality measurement so that health plans and providers can adopt digital HEDIS and electronic clinical data with greater confidence in the underlying logic and engine behavior.

*(Approximately 600 words. Verify count on the form and trim if required.)*

---

## Promotional Description

**200 words, avoiding abbreviations. Used on the website to attract attendees.**

---

Clinical Quality Language (CQL) and Fast Healthcare Interoperability Resources (FHIR) are at the heart of digital quality measurement and digital HEDIS, but authoring and testing CQL against real FHIR data and terminology often means juggling multiple tools and servers. This session shares the implementation journey and lessons learned from building CQL Studio, an open-source web application that provides an integrated environment for developing, testing, and publishing CQL and FHIR-based artifacts. You will hear how we connected FHIR terminology services (value sets, code systems, concept maps) to a single browser-based workflow, how we integrated standard Library operations to run CQL against your FHIR data, and how we wired in the official CQL engine compatibility test suite for validation and results analysis. We will cover practical decisions and trade-offs: why we chose a web-based design, how we handled configuration for different environments, and how stakeholders from the measure development and health plan community influenced the product. Whether you are a measure developer, health information technology (IT) lead, or quality analyst working toward digital HEDIS and electronic clinical data, you will leave with actionable steps and open-source tools you can adopt or adapt to improve your own CQL and FHIR authoring and testing workflows.

---

## Learning Objectives

**What attendees will be able to understand, apply, or do after your session. At least three; action-focused.**

1. **Describe** how FHIR terminology services (value set and code system search, expand, and validate) can be integrated into a web-based authoring environment to support CQL measure development.

2. **Apply** standard FHIR Library operations (evaluate and CQL) to run CQL logic against a configured FHIR data endpoint and interpret execution results in a testing workflow.

3. **Use** the concept of a configurable FHIR and terminology base address to design or adapt tooling that works across development, testing, and production environments without code changes.

4. **Explain** how the official CQL engine compatibility test suite can be used to validate measure logic and engine behavior, and how result analysis (filtering, sorting, cross-engine comparison) supports quality assurance before production.

---

## Key Takeaways

**The most important insights or lessons attendees will leave with. At least three; distinct from Learning Objectives.**

1. A single, FHIR-native authoring and testing workflow reduces errors and accelerates measure development by keeping terminology lookup, CQL editing, execution, and engine validation in one place instead of across disconnected tools.

2. Building on published FHIR and CQL standards (terminology APIs, Library operations, engine test suite) future-proofs tooling as NCQA and the industry evolve digital HEDIS and electronic clinical data system requirements.

3. Involving measure developers and health plan IT staff early in design ensures that integrated tooling addresses real workflows (e.g., value set binding, running against plan or provider data) and supports digital quality and certification needs.

4. Web-based, Docker-ready deployment with configurable endpoints lets organizations adopt the same authoring and testing experience while keeping data and terminology under their control and compliant with their security and governance.

---

## How Can Attendees Replicate the Strategies, Innovations, or Programs?

**Clear, actionable steps, tools, or frameworks organizations can adopt or adapt.**

1. **Use or evaluate CQL Studio.** Download and run CQL Studio via Docker or from source (Apache 2.0 license). Configure your organization’s FHIR server base address and terminology server base address (e.g., Value Set Authority Center or an internal FHIR terminology service). Use the integrated CQL editor, terminology browser, and execution features to author and test a measure against your own data.

2. **Adopt a FHIR-first integration pattern.** When building or buying measure authoring or testing tools, require support for standard FHIR terminology service APIs (value set and code system search, expand, validate) and FHIR Library operations for CQL execution. Document the base addresses and any authentication so that development, testing, and production can be switched without changing application code.

3. **Incorporate the official CQL engine compatibility suite.** Use the CQFramework CQL Tests Runner (or equivalent) in your pipeline so that measure logic and engines are validated against the same test suite. Integrate result review (filtering, sorting, failure analysis) into your quality assurance process before certification or production rollout.

4. **Engage stakeholders early.** Involve measure developers, health plan IT, and quality analysts when defining requirements for authoring and testing tooling. Prioritize workflows they use daily (e.g., value set lookup, run against sample or production-like FHIR data) so that the tools you adopt or build directly support digital quality and HEDIS implementation.

---

## Form Selections (confirm on submission site)

### Theme of your session

*If the form provides a list, choose the theme that best matches “digital quality” or “quality measurement and improvement.” If free text, you could use: “Powering quality with digital transformation” or “Digital quality measurement and interoperability.”*

### Track(s)

- [x] **Health IT**
- [x] **HEDIS® / Digital Quality**
- [ ] Care Delivery
- [ ] Health Plan

### Session Topics

*Select all that apply; suggested:*

- [x] **Digital Quality**
- [x] **HEDIS®**
- [x] **Interoperability**
- [x] **Quality Measurement and Improvement**
- [ ] Data Quality and Usability
- [ ] Automation
- [ ] Other *(as needed)*

### Level of expertise of intended audience

- [ ] Introductory Level
- [x] **Intermediate Level**
- [ ] Advanced Level

### Supplemental Materials

*Optional.* If you upload a file, examples: implementation guide or short document describing CQL Studio and replication steps; link to GitHub or cqlstudio.com in the description.

### Alternative presentation opportunity (if not selected for a concurrent session)

- [ ] Yes, the Pre-Conference Webinar Series
- [ ] Yes, the Poster Board Showcase
- [x] **Yes, both** *(recommended)*
- [ ] No, not interested

---

## Checklist Before Submitting

- [ ] Session title pasted (85 characters or less).
- [ ] Session description pasted (600 words; check paragraph length and required elements).
- [ ] Promotional description pasted (200 words).
- [ ] Learning Objectives and Key Takeaways pasted (at least three each).
- [ ] “How can attendees replicate” section pasted.
- [ ] Theme, track(s), session topics, and expertise level selected.
- [ ] Supplemental materials uploaded if desired.
- [ ] Alternative presentation option selected.
- [ ] Speaker and contact details completed where required.

---

## References

- [NCQA Health Innovation Summit 2026](https://www.ncqa.org/events/health-innovation-summit-2026/)
- [NCQA – How Digital Measures Execute with Clinical Quality Language](https://www.ncqa.org/resources/how-digital-measures-execute-with-clinical-quality-language/)
- [NCQA – HEDIS Digital Quality Measures](https://www.ncqa.org/hedis/the-future-of-hedis/digital-measures/)
- [CQL Studio – GitHub](https://github.com/cqframework/cql-studio)
- [CQL Studio – cqlstudio.com](https://cqlstudio.com)
