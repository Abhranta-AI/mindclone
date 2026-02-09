const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, PageNumber, LevelFormat } = require('docx');
const fs = require('fs');

// Helper for creating table cells
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function createCell(text, width, shading = null, bold = false) {
    return new TableCell({
        borders,
        width: { size: width, type: WidthType.DXA },
        shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
        margins: cellMargins,
        children: [new Paragraph({
            children: [new TextRun({ text, bold, font: "Arial", size: 22 })]
        })]
    });
}

const doc = new Document({
    styles: {
        default: { document: { run: { font: "Arial", size: 24 } } },
        paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 36, bold: true, font: "Arial", color: "1a1a2e" },
              paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
            { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 28, bold: true, font: "Arial", color: "16213e" },
              paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
            { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 24, bold: true, font: "Arial", color: "0f3460" },
              paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
        ]
    },
    numbering: {
        config: [
            { reference: "bullets",
              levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
                { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }] },
            { reference: "numbers",
              levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        ]
    },
    sections: [{
        properties: {
            page: {
                size: { width: 12240, height: 15840 },
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
            }
        },
        headers: {
            default: new Header({
                children: [new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: "Mindclone PRD | Confidential", italics: true, size: 20, color: "666666" })]
                })]
            })
        },
        footers: {
            default: new Footer({
                children: [new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: "Page ", size: 20 }), new TextRun({ children: [PageNumber.CURRENT], size: 20 })]
                })]
            })
        },
        children: [
            // TITLE
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 100 },
                children: [new TextRun({ text: "PRODUCT REQUIREMENTS DOCUMENT", bold: true, size: 28, color: "8b5cf6" })]
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                children: [new TextRun({ text: "Mindclone Social Agent", bold: true, size: 48 })]
            }),

            // META INFO TABLE
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [2340, 7020],
                rows: [
                    new TableRow({ children: [
                        createCell("Version", 2340, "E8E8E8", true),
                        createCell("1.0", 7020)
                    ]}),
                    new TableRow({ children: [
                        createCell("Date", 2340, "E8E8E8", true),
                        createCell("February 9, 2026", 7020)
                    ]}),
                    new TableRow({ children: [
                        createCell("Author", 2340, "E8E8E8", true),
                        createCell("Alok Gotam / Claude", 7020)
                    ]}),
                    new TableRow({ children: [
                        createCell("Status", 2340, "E8E8E8", true),
                        createCell("Draft - Ready for Review", 7020)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 400 }, children: [] }),

            // EXECUTIVE SUMMARY
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Executive Summary")] }),
            new Paragraph({
                spacing: { after: 200 },
                children: [new TextRun({
                    text: "Mindclone is an AI platform where each user has a personal AI companion (their \"mindclone\") that deeply understands their cognitive identity - their drives, values, beliefs, and personality. This PRD defines the transformation of Mindclone from a form-based matching system to a conversational social agent that autonomously networks on behalf of its human.",
                    size: 24
                })]
            }),

            // 1. PROBLEM STATEMENT
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Problem Statement")] }),
            new Paragraph({
                spacing: { after: 200 },
                children: [new TextRun({
                    text: "The current Mindclone matching system requires users to fill out rigid, form-based profiles for predefined categories (Dating, Investing, Hiring, Networking). This creates several problems:",
                    size: 24
                })]
            }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Disconnect from core experience: ", bold: true }),
                new TextRun("Users already share their goals, values, and needs through natural conversation with their mindclone. Filling forms feels redundant and transactional.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Rigid categories limit use cases: ", bold: true }),
                new TextRun("Real networking needs are dynamic - \"coffee in 15 min\", \"co-founder who gets payments\", \"someone to discuss philosophy\" - none of which fit predefined boxes.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Passive, not proactive: ", bold: true }),
                new TextRun("The mindclone waits for a cron job instead of actively searching when the user needs connections.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun({ text: "Lost context: ", bold: true }),
                new TextRun("The mindclone already knows the user deeply but ignores this knowledge, asking them to re-enter information in forms.")
            ]}),
            new Paragraph({
                spacing: { after: 300 },
                children: [new TextRun({
                    text: "Cost of not solving: Users experience friction, low engagement with matching features, and the platform fails to deliver on its core promise - a mindclone that truly acts on your behalf.",
                    italics: true, size: 24
                })]
            }),

            // 2. VISION
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. Vision")] }),
            new Paragraph({
                spacing: { after: 200 },
                shading: { fill: "F3E8FF", type: ShadingType.CLEAR },
                children: [new TextRun({
                    text: "\"Your mindclone is your trusted social agent. You talk to it naturally about what you need, and it goes out to find the right people for you - handling the awkward first conversations so you can focus on meaningful connections.\"",
                    italics: true, size: 26
                })]
            }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("The Three Modes of Mindclone")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [2000, 3680, 3680],
                rows: [
                    new TableRow({ children: [
                        createCell("Mode", 2000, "8b5cf6", true),
                        createCell("Description", 3680, "8b5cf6", true),
                        createCell("Example", 3680, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("Companion", 2000),
                        createCell("Friend, philosopher, guide. Learns about the user through conversation.", 3680),
                        createCell("\"Help me think through this career decision\"", 3680)
                    ]}),
                    new TableRow({ children: [
                        createCell("Agent", 2000),
                        createCell("Goes out and networks on user's behalf. Searches, initiates M2M conversations, reports back.", 3680),
                        createCell("\"Find me investors who understand AI infrastructure\"", 3680)
                    ]}),
                    new TableRow({ children: [
                        createCell("Representative", 2000),
                        createCell("Speaks to others on user's behalf via public Link or M2M conversations.", 3680),
                        createCell("Investor visits user's Link to learn about their startup", 3680)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 300 }, children: [] }),

            // 3. GOALS
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Goals")] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("User Goals")] }),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [
                new TextRun({ text: "Natural networking: ", bold: true }),
                new TextRun("Users can request connections through natural conversation, not forms. Success: 80% of matching requests initiated via chat (not forms).")
            ]}),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [
                new TextRun({ text: "Any-purpose matching: ", bold: true }),
                new TextRun("Support dynamic intents beyond fixed categories. Success: Users successfully match for 5+ distinct intent types in first month.")
            ]}),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [
                new TextRun({ text: "Transparent autonomy: ", bold: true }),
                new TextRun("Users trust their mindclone to network while maintaining visibility. Success: 70% of users review at least one M2M conversation summary.")
            ]}),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun({ text: "Meaningful connections: ", bold: true }),
                new TextRun("Matches lead to real human interaction. Success: 40% of mutual matches result in H2H communication.")
            ]}),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Business Goals")] }),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [
                new TextRun({ text: "Increase engagement: ", bold: true }),
                new TextRun("Daily active users increase 50% within 3 months of launch.")
            ]}),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [
                new TextRun({ text: "Differentiation: ", bold: true }),
                new TextRun("Establish Mindclone as the only platform where AI truly networks on your behalf.")
            ]}),
            new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun({ text: "Network effects: ", bold: true }),
                new TextRun("Each new user increases value for existing users through expanded matching pool.")
            ]}),

            // 4. NON-GOALS
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. Non-Goals (v1)")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Full messaging platform: ", bold: true }),
                new TextRun("We will not build a complete H2H chat system. We facilitate connection, then let users choose their preferred channel (WhatsApp, email, etc.).")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Location-based real-time matching: ", bold: true }),
                new TextRun("\"Coffee in 15 min\" requires geolocation infrastructure. Deferred to v2.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Voice/video calls: ", bold: true }),
                new TextRun("Mindclone operates via text. Voice/video is out of scope.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "Automated scheduling: ", bold: true }),
                new TextRun("Calendar integration and meeting scheduling deferred to v2.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun({ text: "Mindclone-to-human direct outreach: ", bold: true }),
                new TextRun("In v1, mindclones only talk to other mindclones, not directly to other humans (except via public Link).")
            ]}),

            // 5. USER STORIES
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. User Stories")] }),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.1 Conversational Matching")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a founder, I want to tell my mindclone \"find me investors who understand AI and are okay with early-stage\" so that I don't have to fill out forms or browse profiles.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want my mindclone to already know my context (from our conversations) so that I don't have to re-explain who I am or what I'm building.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("As a user, I want to request matches for any purpose (not just predefined categories) so that I can find \"someone to discuss philosophy\" or \"a designer who gets AI interfaces\".")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.2 Mindclone-to-Mindclone Conversations")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want my mindclone to have initial conversations with potential matches so that I skip the awkward \"getting to know you\" phase.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want to see a summary of what my mindclone discussed so that I can trust what was said on my behalf.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("As a user, I want to optionally read the full M2M transcript so that I can verify my mindclone represented me accurately.")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.3 Match Approval & Connection")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want to approve or reject matches based on my mindclone's summary so that I control who I connect with.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, when both parties approve, I want to see their preferred contact method so that I can reach out directly.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("As a user, I want my mindclone to tell me why it thinks this is a good match so that I can make an informed decision.")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.4 Visibility & Control")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want to see who has talked to my public Link mindclone so that I know who's interested in me.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("As a user, I want my mindclone to highlight important visitors (potential leads, investors) so that I don't miss opportunities.")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun("As a user, I want to control what my mindclone can share about me so that I maintain privacy boundaries.")
            ]}),

            // 6. REQUIREMENTS
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. Requirements")] }),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("P0: Must-Have (MVP)")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [700, 5660, 3000],
                rows: [
                    new TableRow({ children: [
                        createCell("ID", 700, "8b5cf6", true),
                        createCell("Requirement", 5660, "8b5cf6", true),
                        createCell("Acceptance Criteria", 3000, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.1", 700),
                        createCell("Conversational search trigger: User can initiate a search request via natural language in main chat.", 5660),
                        createCell("\"Find me X\" triggers search flow, not form redirect", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.2", 700),
                        createCell("Intent extraction: Mindclone extracts who, why, what qualities from user's request.", 5660),
                        createCell("Mindclone confirms understanding before searching", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.3", 700),
                        createCell("Cognitive profile auto-build: Mindclone uses conversation history to build networking-relevant profile automatically.", 5660),
                        createCell("No forms required to enable matching", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.4", 700),
                        createCell("M2M conversation: Mindclone initiates and conducts conversation with matched mindclone.", 5660),
                        createCell("10-round phased conversation completes", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.5", 700),
                        createCell("M2M summary visible: User sees summary of M2M conversation with key insights.", 5660),
                        createCell("Summary appears in chat after M2M completes", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.6", 700),
                        createCell("Match approval: User can approve/reject match from within chat.", 5660),
                        createCell("Inline approve/reject buttons in chat", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.7", 700),
                        createCell("Contact reveal: On mutual approval, show other user's preferred contact method.", 5660),
                        createCell("Email/WhatsApp/preference displayed", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P0.8", 700),
                        createCell("Remove form-based matching UI: Eliminate Matching tab forms, replace with conversational prompt.", 5660),
                        createCell("No more category-based profile forms", 3000)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("P1: Nice-to-Have")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [700, 5660, 3000],
                rows: [
                    new TableRow({ children: [
                        createCell("ID", 700, "D8B4FE", true),
                        createCell("Requirement", 5660, "D8B4FE", true),
                        createCell("Notes", 3000, "D8B4FE", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("P1.1", 700),
                        createCell("Full M2M transcript view: User can expand to read complete conversation.", 5660),
                        createCell("Expandable section in chat", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P1.2", 700),
                        createCell("Proactive suggestions: Mindclone suggests potential matches without being asked.", 5660),
                        createCell("\"I noticed someone who might...\"", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P1.3", 700),
                        createCell("Link visitor highlights: Smart categorization of public Link visitors.", 5660),
                        createCell("\"Hot lead\", \"Investor\", \"Curious\"", 3000)
                    ]}),
                    new TableRow({ children: [
                        createCell("P1.4", 700),
                        createCell("Simple in-app H2H chat: Optional text chat with matched user.", 5660),
                        createCell("Basic messaging, no media", 3000)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("P2: Future Considerations")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Location-based matching (\"coffee nearby\")")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Time-based matching (\"free in 30 min\")")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Calendar integration for scheduling")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Mindclone-to-human direct outreach")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun("Voice interaction with mindclone")
            ]}),

            // 7. CONVERSATION VISIBILITY MODEL
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("7. Conversation Visibility Model")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [2340, 3510, 3510],
                rows: [
                    new TableRow({ children: [
                        createCell("Conversation Type", 2340, "8b5cf6", true),
                        createCell("Visibility", 3510, "8b5cf6", true),
                        createCell("Rationale", 3510, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("Human \u2194 Own Mindclone", 2340),
                        createCell("Fully private. Never shared.", 3510),
                        createCell("This is where learning happens. Sacred.", 3510)
                    ]}),
                    new TableRow({ children: [
                        createCell("Mindclone \u2194 Mindclone", 2340),
                        createCell("Summary visible to both humans. Full transcript optional.", 3510),
                        createCell("Trust without overload. Users can verify if needed.", 3510)
                    ]}),
                    new TableRow({ children: [
                        createCell("Visitor \u2194 Your Mindclone", 2340),
                        createCell("Visible to you with smart prioritization.", 3510),
                        createCell("It's YOUR agent. You need to know who's interested.", 3510)
                    ]}),
                    new TableRow({ children: [
                        createCell("Human \u2194 Human (post-match)", 2340),
                        createCell("Private between the two humans.", 3510),
                        createCell("Mindclone steps back. Humans take over.", 3510)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 300 }, children: [] }),

            // 8. DATA MODEL CHANGES
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("8. Data Model Changes")] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("New: Cognitive Profile (auto-built)")] }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "users/{userId}/cognitiveProfile/", font: "Courier New", size: 22 })]
            }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "identity: ", bold: true }),
                new TextRun("Who they are (role, company, background)")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "drives: ", bold: true }),
                new TextRun("What motivates them")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "values: ", bold: true }),
                new TextRun("What they care about")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "currentNeeds: ", bold: true }),
                new TextRun("What they're looking for RIGHT NOW")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun({ text: "networkingStyle: ", bold: true }),
                new TextRun("How they prefer to connect")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("New: Active Searches")] }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "users/{userId}/activeSearches/{searchId}/", font: "Courier New", size: 22 })]
            }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "intent: ", bold: true }),
                new TextRun("Original user request (\"find co-founder in payments\")")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "extractedCriteria: ", bold: true }),
                new TextRun("Parsed criteria (role, industry, qualities)")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun({ text: "matches[]: ", bold: true }),
                new TextRun("Found matches with scores")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun({ text: "status: ", bold: true }),
                new TextRun("searching | found | presented | connected")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Deprecated")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun({ text: "matchingProfiles/{userId}/profiles/[dating|investing|hiring|networking]: ", strikeThrough: true }),
                new TextRun("Replaced by cognitiveProfile")
            ]}),

            // 9. TECHNICAL APPROACH
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("9. Technical Approach")] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Phase 1: Conversational Matching (Week 1-2)")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Add \"findPeople\" tool to chat.js")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Implement intent extraction from natural language")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Connect to existing matching infrastructure")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("Remove form-based matching UI from right panel")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Phase 2: Cognitive Profile (Week 2-3)")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Create cognitiveProfile extraction from conversation history")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Build real-time profile updates as user chats")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("Integrate cognitiveProfile into matching algorithm")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Phase 3: M2M Visibility (Week 3-4)")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Generate M2M conversation summaries")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Display summaries in user's main chat")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Add inline approve/reject buttons")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
                new TextRun("Implement optional full transcript view")
            ]}),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Phase 4: Connection Flow (Week 4)")] }),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Build mutual approval detection")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
                new TextRun("Implement contact preference reveal")
            ]}),
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
                new TextRun("Add Link visitor insights to chat")
            ]}),

            // 10. SUCCESS METRICS
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("10. Success Metrics")] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Leading Indicators (1-4 weeks)")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [3120, 3120, 3120],
                rows: [
                    new TableRow({ children: [
                        createCell("Metric", 3120, "8b5cf6", true),
                        createCell("Target", 3120, "8b5cf6", true),
                        createCell("Stretch", 3120, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("% searches via chat (vs forms)", 3120),
                        createCell("80%", 3120),
                        createCell("95%", 3120)
                    ]}),
                    new TableRow({ children: [
                        createCell("M2M conversations completed", 3120),
                        createCell("100/week", 3120),
                        createCell("500/week", 3120)
                    ]}),
                    new TableRow({ children: [
                        createCell("% users who view M2M summary", 3120),
                        createCell("70%", 3120),
                        createCell("90%", 3120)
                    ]}),
                    new TableRow({ children: [
                        createCell("Match approval rate", 3120),
                        createCell("40%", 3120),
                        createCell("60%", 3120)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Lagging Indicators (1-3 months)")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [3120, 3120, 3120],
                rows: [
                    new TableRow({ children: [
                        createCell("Metric", 3120, "8b5cf6", true),
                        createCell("Target", 3120, "8b5cf6", true),
                        createCell("Stretch", 3120, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("% mutual matches \u2192 H2H contact", 3120),
                        createCell("40%", 3120),
                        createCell("60%", 3120)
                    ]}),
                    new TableRow({ children: [
                        createCell("DAU increase", 3120),
                        createCell("+50%", 3120),
                        createCell("+100%", 3120)
                    ]}),
                    new TableRow({ children: [
                        createCell("User satisfaction (NPS)", 3120),
                        createCell("+10 points", 3120),
                        createCell("+20 points", 3120)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 300 }, children: [] }),

            // 11. OPEN QUESTIONS
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("11. Open Questions")] }),
            new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [5500, 2000, 1860],
                rows: [
                    new TableRow({ children: [
                        createCell("Question", 5500, "8b5cf6", true),
                        createCell("Owner", 2000, "8b5cf6", true),
                        createCell("Blocking?", 1860, "8b5cf6", true)
                    ]}),
                    new TableRow({ children: [
                        createCell("Should we keep any form-based input as fallback for new users?", 5500),
                        createCell("Product", 2000),
                        createCell("No", 1860)
                    ]}),
                    new TableRow({ children: [
                        createCell("How do we handle users who haven't chatted enough to build cognitive profile?", 5500),
                        createCell("Product/Eng", 2000),
                        createCell("Yes", 1860)
                    ]}),
                    new TableRow({ children: [
                        createCell("What's the minimum conversation history needed for matching?", 5500),
                        createCell("Engineering", 2000),
                        createCell("Yes", 1860)
                    ]}),
                    new TableRow({ children: [
                        createCell("How do we handle abuse/spam in M2M conversations?", 5500),
                        createCell("Engineering", 2000),
                        createCell("No", 1860)
                    ]}),
                    new TableRow({ children: [
                        createCell("Should M2M conversations count toward API costs for both users?", 5500),
                        createCell("Business", 2000),
                        createCell("No", 1860)
                    ]}),
                ]
            }),
            new Paragraph({ spacing: { after: 300 }, children: [] }),

            // 12. APPENDIX
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("12. Appendix: Example User Flow")] }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "User: \"Hey, I need to find some investors who understand AI infrastructure and are comfortable with early-stage messiness.\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "EDE9FE", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "Mindclone: \"Got it! Based on our conversations, I know you're building Mindclone, you're at pre-seed stage, and you value investors who are hands-off but available for strategic advice. I'll look for seed/pre-seed investors focused on AI infrastructure who prefer founder independence. Sound right?\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "User: \"Yes, exactly.\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "EDE9FE", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "Mindclone: \"Great, I'm on it. I'll talk to some mindclones and report back with anyone promising.\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: "[... time passes, M2M conversations happen ...]", italics: true, size: 22 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "EDE9FE", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "Mindclone: \"I found someone interesting! Priya is a seed-stage investor at Accel focused on AI infrastructure. From talking to her mindclone, she values founder independence, prefers hands-off approach but is available for strategic calls. She's invested in 3 AI infra companies before. I think you'd click. Want to see our conversation or just connect?\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "User: \"What did you tell her about us?\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "EDE9FE", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "Mindclone: \"I shared that you're building Mindclone - an AI social platform, you're pre-seed, looking for investors who understand long-term AI vision. I mentioned your background in [X]. Here's the full conversation if you want to review it. [Expand transcript]\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "User: \"Looks good. Let's connect.\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({
                spacing: { after: 100 },
                shading: { fill: "DCFCE7", type: ShadingType.CLEAR },
                children: [new TextRun({ text: "Mindclone: \"Done! Priya also approved the connection. She prefers WhatsApp: +91-XXXXX. She's usually responsive in mornings IST. Good luck!\"", font: "Courier New", size: 20 })]
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            // END
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 400 },
                children: [new TextRun({ text: "--- END OF DOCUMENT ---", color: "888888", size: 20 })]
            }),
        ]
    }]
});

Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync("/sessions/blissful-determined-brown/mnt/mindclone/Mindclone_Social_Agent_PRD.docx", buffer);
    console.log("PRD document created successfully!");
});
