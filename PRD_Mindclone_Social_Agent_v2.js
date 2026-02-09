const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, BorderStyle, WidthType, ShadingType, AlignmentType,
        LevelFormat, PageBreak } = require('docx');
const fs = require('fs');

// Helper to create styled text
const text = (content, options = {}) => new TextRun({ text: content, ...options });
const bold = (content) => new TextRun({ text: content, bold: true });
const italic = (content) => new TextRun({ text: content, italics: true });

// Helper for paragraphs
const para = (children, options = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [text(children)],
  ...options
});

// Helper for headings
const h1 = (content) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text(content)] });
const h2 = (content) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text(content)] });
const h3 = (content) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [text(content)] });

// Table styling
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Create table helper
function createTable(headers, rows, colWidths) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      // Header row
      new TableRow({
        children: headers.map((header, i) => new TableCell({
          borders,
          width: { size: colWidths[i], type: WidthType.DXA },
          shading: { fill: "E8E0F0", type: ShadingType.CLEAR },
          margins: cellMargins,
          children: [para([bold(header)])]
        }))
      }),
      // Data rows
      ...rows.map(row => new TableRow({
        children: row.map((cell, i) => new TableCell({
          borders,
          width: { size: colWidths[i], type: WidthType.DXA },
          margins: cellMargins,
          children: [para(cell)]
        }))
      }))
    ]
  });
}

// Document content
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "6B21A8" },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
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
    children: [
      // Title
      para([bold("PRODUCT REQUIREMENTS DOCUMENT")], { alignment: AlignmentType.CENTER }),
      para([bold("Mindclone Social Agent")], { alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

      // Meta table
      createTable(
        ["Field", "Value"],
        [
          ["Version", "2.0"],
          ["Date", "February 9, 2026"],
          ["Author", "Alok Gotam / Claude"],
          ["Status", "Final - Ready for Implementation"]
        ],
        [2500, 6860]
      ),

      para("", { spacing: { after: 400 } }),

      // Executive Summary
      h1("Executive Summary"),
      para("Mindclone is an AI platform where each user has a personal AI companion (their \"mindclone\") that deeply understands their cognitive identity - their drives, values, beliefs, and personality. This PRD defines the transformation of Mindclone from a form-based matching system to a purely conversational social agent that autonomously networks on behalf of its human."),
      para(""),
      para([bold("Core Philosophy: "), text("Your mindclone protects you from rejection. When mindclones network on your behalf, you only hear about successes - never failures. If a potential match isn't right, your mindclone quietly moves on and you never know. This preserves the emotional safety that makes Mindclone unique.")]),

      // Problem Statement
      new Paragraph({ children: [new PageBreak()] }),
      h1("1. Problem Statement"),
      para("The current Mindclone matching system requires users to fill out rigid, form-based profiles for predefined categories (Dating, Investing, Hiring, Networking). This creates several problems:"),
      para(""),
      para([bold("Disconnect from core experience: "), text("Users already share their goals, values, and needs through natural conversation with their mindclone. Filling forms feels redundant and transactional.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Rigid categories limit use cases: "), text("Real networking needs are dynamic - \"coffee in 15 min\", \"co-founder who gets payments\", \"someone to discuss philosophy\" - none fit predefined boxes.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Passive, not proactive: "), text("The mindclone waits for a cron job instead of actively searching when the user needs connections.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Lost context: "), text("The mindclone already knows the user deeply but ignores this knowledge, asking them to re-enter information in forms.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Separate UI breaks immersion: "), text("A separate \"Matching\" panel with buttons and forms contradicts the conversational nature of the mindclone relationship.")], { numbering: { reference: "bullets", level: 0 } }),
      para(""),
      para([italic("Cost of not solving: Users experience friction, low engagement with matching features, and the platform fails to deliver on its core promise - a mindclone that truly acts on your behalf.")]),

      // Vision
      h1("2. Vision"),
      para([italic("\"Your mindclone is your trusted social agent. You talk to it naturally about what you need, and it goes out to find the right people for you - handling the awkward first conversations so you can focus on meaningful connections. You never experience rejection because your mindclone shields you from it.\"")]),
      para(""),

      h2("The Three Modes of Mindclone"),
      createTable(
        ["Mode", "Description", "Example"],
        [
          ["Companion", "Friend, philosopher, guide. Learns about you through conversation.", "\"Help me think through this career decision\""],
          ["Agent", "Goes out and networks on your behalf. Searches, talks to other mindclones, reports back successes only.", "\"Find me investors who understand AI\""],
          ["Representative", "Speaks to others on your behalf via public Link or M2M conversations.", "Investor visits your Link to learn about your startup"]
        ],
        [1800, 4000, 3560]
      ),

      para(""),
      h2("Key Principle: Mindclone-Mediated Approval"),
      para([bold("Humans never approve or reject matches. Mindclones do.")]),
      para("When your mindclone finds a potential match, it has a conversation with their mindclone. After the conversation:"),
      para("Each mindclone independently decides: \"Would my human want this connection?\"", { numbering: { reference: "bullets", level: 0 } }),
      para("If BOTH mindclones approve: The humans are notified of the match with contact info.", { numbering: { reference: "bullets", level: 0 } }),
      para("If EITHER mindclone rejects: Silent rejection. Neither human ever knows. No feelings hurt.", { numbering: { reference: "bullets", level: 0 } }),
      para(""),
      para([italic("This is the core innovation: Your mindclone advocates for you behind the scenes, protecting you from the emotional pain of rejection while ensuring you only connect with people who genuinely want to connect with you.")]),

      // Goals
      new Paragraph({ children: [new PageBreak()] }),
      h1("3. Goals"),

      h2("User Goals"),
      para([bold("Natural networking: "), text("Users can request connections through natural conversation in the main chat, not forms or separate panels. Success: 100% of matching requests initiated via main chat conversation.")], { numbering: { reference: "numbers", level: 0 } }),
      para([bold("Any-purpose matching: "), text("Support dynamic intents beyond fixed categories. Success: Users successfully match for 5+ distinct intent types in first month.")], { numbering: { reference: "numbers", level: 0 } }),
      para([bold("Emotional safety: "), text("Users never experience rejection - only successful matches. Success: 0% of users see \"rejected\" status.")], { numbering: { reference: "numbers", level: 0 } }),
      para([bold("Transparent autonomy: "), text("Users trust their mindclone and can see what it said on their behalf. Success: 70% of users review at least one M2M conversation summary.")], { numbering: { reference: "numbers", level: 0 } }),
      para([bold("Meaningful connections: "), text("Matches lead to real human interaction. Success: 40% of mutual matches result in H2H communication.")], { numbering: { reference: "numbers", level: 0 } }),

      h2("Business Goals"),
      para("Increase engagement: Daily active users increase 50% within 3 months of launch.", { numbering: { reference: "numbers", level: 0 } }),
      para("Differentiation: Establish Mindclone as the only platform where AI truly networks on your behalf AND protects you from rejection.", { numbering: { reference: "numbers", level: 0 } }),
      para("Network effects: Each new user increases value for existing users through expanded matching pool.", { numbering: { reference: "numbers", level: 0 } }),

      // Non-Goals
      h1("4. Non-Goals (v1)"),
      para([bold("Separate matching UI: "), text("NO matching tab, panel, buttons, or forms. Everything happens in the main conversation.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Human approval flow: "), text("Humans do NOT approve/reject matches. Mindclones decide autonomously.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Full messaging platform: "), text("We facilitate connection, then let users choose their preferred channel (WhatsApp, email, etc.).")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Location-based real-time matching: "), text("\"Coffee in 15 min\" requires geolocation infrastructure. Deferred to v2.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Voice/video calls: "), text("Mindclone operates via text. Voice/video is out of scope.")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Automated scheduling: "), text("Calendar integration and meeting scheduling deferred to v2.")], { numbering: { reference: "bullets", level: 0 } }),

      // User Stories
      new Paragraph({ children: [new PageBreak()] }),
      h1("5. User Stories"),

      h2("5.1 Conversational Matching (Main Chat Only)"),
      para([italic("As a founder, I want to tell my mindclone \"find me investors who understand AI and are okay with early-stage\" in our regular conversation so that I don't have to navigate to any special panel or fill out forms.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want my mindclone to already know my context (from our conversations) so that I don't have to re-explain who I am or what I'm building.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want to request matches for any purpose (not just predefined categories) so that I can find \"someone to discuss philosophy\" or \"a designer who gets AI interfaces\".")], { numbering: { reference: "bullets", level: 0 } }),

      h2("5.2 Mindclone-to-Mindclone Conversations"),
      para([italic("As a user, I want my mindclone to have initial conversations with potential matches so that I skip the awkward \"getting to know you\" phase.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want my mindclone to tell me about matches in our regular conversation (not in a separate panel) so that our relationship feels seamless.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want to see a summary of what my mindclone discussed so that I can trust what was said on my behalf.")], { numbering: { reference: "bullets", level: 0 } }),

      h2("5.3 Mindclone Auto-Approval (NEW)"),
      para([italic("As a user, I want my mindclone to decide on my behalf whether a match is good for me so that I never have to reject anyone or feel rejected.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want to only hear about successful matches so that I feel positive about networking, not anxious.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want to trust that my mindclone knows me well enough to make good decisions on my behalf.")], { numbering: { reference: "bullets", level: 0 } }),

      h2("5.4 Connection & Contact Reveal"),
      para([italic("As a user, when both mindclones approve, I want my mindclone to tell me in our conversation (with their contact info) so I can reach out directly.")], { numbering: { reference: "bullets", level: 0 } }),
      para([italic("As a user, I want my mindclone to tell me why it thinks this is a good match so that I can make an informed decision about reaching out.")], { numbering: { reference: "bullets", level: 0 } }),

      // Requirements
      new Paragraph({ children: [new PageBreak()] }),
      h1("6. Requirements"),

      h2("P0: Must-Have (MVP)"),
      createTable(
        ["ID", "Requirement", "Acceptance Criteria"],
        [
          ["P0.1", "Conversational search in main chat: User initiates search via natural language in the main conversation.", "\"Find me X\" triggers search - NO form, NO panel, NO redirect"],
          ["P0.2", "Intent extraction: Mindclone extracts who, why, what qualities from user's request.", "Mindclone confirms understanding before searching"],
          ["P0.3", "Cognitive profile auto-build: Mindclone uses conversation history to build profile automatically.", "No forms required to enable matching"],
          ["P0.4", "M2M conversation: Mindclone initiates and conducts conversation with matched mindclone.", "10-round phased conversation completes autonomously"],
          ["P0.5", "M2M summary in chat: User sees summary of M2M conversation in main chat.", "Summary appears as mindclone message in regular conversation"],
          ["P0.6", "Mindclone auto-approval: Each mindclone decides if their human would want the connection.", "No human approve/reject buttons anywhere"],
          ["P0.7", "Silent rejection: If either mindclone rejects, humans never know.", "Rejected matches are invisible to users"],
          ["P0.8", "Contact reveal in chat: On mutual mindclone approval, contact info shown in conversation.", "Email/WhatsApp displayed as part of match notification message"],
          ["P0.9", "REMOVE matching UI: Eliminate Matching tab, panel, buttons, forms entirely.", "No separate matching interface exists"]
        ],
        [800, 4000, 4560]
      ),

      h2("P1: Nice-to-Have"),
      createTable(
        ["ID", "Requirement", "Notes"],
        [
          ["P1.1", "Full M2M transcript view: User can ask mindclone to show full conversation.", "\"Show me what you discussed\" expands in chat"],
          ["P1.2", "Proactive suggestions: Mindclone suggests potential matches without being asked.", "\"I noticed someone who might interest you...\""],
          ["P1.3", "Link visitor highlights: Smart categorization of public Link visitors.", "\"Hot lead\", \"Investor\", \"Curious\""],
          ["P1.4", "Match confidence: Mindclone explains its confidence level in the match.", "\"I'm very confident / somewhat confident you'd click\""]
        ],
        [800, 4500, 4060]
      ),

      // Conversation Visibility Model
      new Paragraph({ children: [new PageBreak()] }),
      h1("7. Conversation Visibility Model"),
      createTable(
        ["Conversation Type", "Visibility", "Rationale"],
        [
          ["Human <-> Own Mindclone", "Fully private. Never shared.", "This is where learning happens. Sacred."],
          ["Mindclone <-> Mindclone", "Summary visible to both humans (in their chats). Full transcript on request.", "Trust without overload. Users can verify if needed."],
          ["Visitor <-> Your Mindclone", "Visible to you with smart prioritization.", "It's YOUR agent. You need to know who's interested."],
          ["Human <-> Human (post-match)", "Private between the two humans.", "Mindclone steps back. Humans take over."]
        ],
        [2800, 3500, 3060]
      ),

      // Mindclone Decision Process
      h1("8. Mindclone Decision Process (NEW)"),
      para("When a M2M conversation completes, each mindclone evaluates independently:"),
      para(""),
      h3("8.1 What Each Mindclone Considers"),
      para([bold("Alignment with human's goals: "), text("Does this person match what my human is looking for?")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Value compatibility: "), text("Do their values align with my human's values?")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Red flags: "), text("Did anything concerning come up in the conversation?")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Mutual benefit: "), text("Would this connection be valuable for my human?")], { numbering: { reference: "bullets", level: 0 } }),
      para(""),
      h3("8.2 Decision Outcomes"),
      createTable(
        ["Mindclone A", "Mindclone B", "Result", "User Experience"],
        [
          ["APPROVE", "APPROVE", "MATCH!", "Both humans notified with contact info in their chats"],
          ["APPROVE", "REJECT", "Silent rejection", "Neither human knows anything happened"],
          ["REJECT", "APPROVE", "Silent rejection", "Neither human knows anything happened"],
          ["REJECT", "REJECT", "Silent rejection", "Neither human knows anything happened"]
        ],
        [2000, 2000, 2500, 2860]
      ),
      para(""),
      para([bold("Key insight: "), text("By having mindclones make the decision, we eliminate the emotional cost of rejection entirely. Your mindclone is your advocate and protector.")]),

      // Technical Approach
      new Paragraph({ children: [new PageBreak()] }),
      h1("9. Technical Approach"),

      h2("Phase 1: Conversational Matching (Week 1-2)"),
      para("Add \"find_people\" tool to chat.js", { numbering: { reference: "bullets", level: 0 } }),
      para("Implement intent extraction from natural language", { numbering: { reference: "bullets", level: 0 } }),
      para("Connect to existing matching infrastructure", { numbering: { reference: "bullets", level: 0 } }),
      para([bold("REMOVE matching panel/tab from UI entirely")], { numbering: { reference: "bullets", level: 0 } }),

      h2("Phase 2: Cognitive Profile (Week 2-3)"),
      para("Create cognitiveProfile extraction from conversation history", { numbering: { reference: "bullets", level: 0 } }),
      para("Build real-time profile updates as user chats", { numbering: { reference: "bullets", level: 0 } }),
      para("Integrate cognitiveProfile into matching algorithm", { numbering: { reference: "bullets", level: 0 } }),

      h2("Phase 3: M2M Visibility in Chat (Week 3-4)"),
      para("Generate M2M conversation summaries", { numbering: { reference: "bullets", level: 0 } }),
      para([bold("Display summaries as messages in user's main chat (not in separate panel)")], { numbering: { reference: "bullets", level: 0 } }),
      para("Implement optional full transcript expansion in chat", { numbering: { reference: "bullets", level: 0 } }),

      h2("Phase 4: Mindclone Auto-Approval (Week 4)"),
      para("Build mindclone decision function using AI evaluation", { numbering: { reference: "bullets", level: 0 } }),
      para("Implement mutual approval detection", { numbering: { reference: "bullets", level: 0 } }),
      para("Create match notification messages for chat", { numbering: { reference: "bullets", level: 0 } }),
      para("Implement silent rejection (no notification, no trace)", { numbering: { reference: "bullets", level: 0 } }),
      para("Add contact info reveal in chat messages", { numbering: { reference: "bullets", level: 0 } }),

      // Example User Flow
      new Paragraph({ children: [new PageBreak()] }),
      h1("10. Example User Flow"),
      para([italic("Everything happens in the main chat. No panels. No forms. No buttons.")]),
      para(""),
      para([bold("User: "), text("\"Hey, I need to find some investors who understand AI infrastructure and are comfortable with early-stage messiness.\"")]),
      para(""),
      para([bold("Mindclone: "), text("\"Got it! Based on our conversations, I know you're building Mindclone, you're at pre-seed stage, and you value investors who are hands-off but available for strategic advice. I'll look for seed/pre-seed investors focused on AI infrastructure who prefer founder independence. Sound right?\"")]),
      para(""),
      para([bold("User: "), text("\"Yes, exactly.\"")]),
      para(""),
      para([bold("Mindclone: "), text("\"Great, I'm on it. I'll talk to some mindclones and let you know if I find anyone promising.\"")]),
      para(""),
      para([italic("[... time passes, M2M conversations happen, mindclones evaluate ...]")]),
      para(""),
      para([bold("Mindclone: "), text("\"Great news! I found someone I think you'd really click with. Priya is a seed-stage investor at Accel focused on AI infrastructure. From talking to her mindclone, she values founder independence, prefers hands-off approach but is available for strategic calls. She's invested in 3 AI infra companies before.")]),
      para(""),
      para([text("I shared that you're building Mindclone, you're pre-seed, and looking for investors who understand long-term AI vision. Her mindclone was impressed and thinks you'd be a good fit too!")]),
      para(""),
      para([text("Here's her contact: priya@accel.com (she prefers email). She's usually responsive in mornings IST.")]),
      para(""),
      para([text("Want me to show you the full conversation we had?\"")]),
      para(""),
      para([bold("User: "), text("\"That's amazing! Yes, show me what you discussed.\"")]),
      para(""),
      para([bold("Mindclone: "), text("[Expands M2M transcript in the chat]")]),
      para(""),
      para([italic("Note: The user never sees rejected matches. If Priya's mindclone had decided she wasn't interested, this user would simply never hear about her. No rejection. No bad feelings.")]),

      // Success Metrics
      new Paragraph({ children: [new PageBreak()] }),
      h1("11. Success Metrics"),

      h2("Leading Indicators (1-4 weeks)"),
      createTable(
        ["Metric", "Target", "Stretch"],
        [
          ["% searches via main chat (no panel)", "100%", "100%"],
          ["M2M conversations completed", "100/week", "500/week"],
          ["% users who see M2M summary in chat", "70%", "90%"],
          ["Mindclone approval rate", "40%", "60%"],
          ["% users who see any rejection", "0%", "0%"]
        ],
        [5000, 2180, 2180]
      ),

      h2("Lagging Indicators (1-3 months)"),
      createTable(
        ["Metric", "Target", "Stretch"],
        [
          ["% mutual matches -> H2H contact", "40%", "60%"],
          ["DAU increase", "+50%", "+100%"],
          ["User satisfaction (NPS)", "+10 points", "+20 points"],
          ["% users who report feeling rejected", "0%", "0%"]
        ],
        [5000, 2180, 2180]
      ),

      // What NOT to Build
      h1("12. What NOT to Build"),
      para([bold("This section exists to prevent scope creep and ensure we stay true to the conversational vision.")]),
      para(""),
      para([bold("NO Matching tab or panel"), text(" - Everything in main chat")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Quick action buttons"), text(" - Users type naturally, not click buttons")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Search input box"), text(" - Users just talk to their mindclone")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Approve/Reject buttons"), text(" - Mindclones decide autonomously")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO \"Pending matches\" section"), text(" - Users only see successful matches")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Form-based profiles"), text(" - Cognitive profile built from conversation")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Category selection"), text(" - Intent extracted from natural language")], { numbering: { reference: "bullets", level: 0 } }),
      para([bold("NO Badge showing \"pending\""), text(" - Only show count of successful matches if any")], { numbering: { reference: "bullets", level: 0 } }),

      // End
      para(""),
      para("--- END OF DOCUMENT ---", { alignment: AlignmentType.CENTER }),
    ]
  }]
});

// Generate the document
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/sessions/blissful-determined-brown/mnt/mindclone/Mindclone_Social_Agent_PRD_v2.docx', buffer);
  console.log('PRD v2 generated successfully!');
});
