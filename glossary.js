const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, BorderStyle, WidthType, ShadingType, AlignmentType,
        LevelFormat, PageBreak, Header, Footer, PageNumber } = require('docx');
const fs = require('fs');

// Helpers
const text = (content, options = {}) => new TextRun({ text: content, ...options });
const bold = (content, options = {}) => new TextRun({ text: content, bold: true, ...options });
const italic = (content, options = {}) => new TextRun({ text: content, italics: true, ...options });

const para = (children, options = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [text(children)],
  ...options
});

// Table styling
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorderBottom = { top: border, bottom: { style: BorderStyle.NONE }, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Section header row
function sectionRow(title, colWidths) {
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: colWidths[0], type: WidthType.DXA },
        columnSpan: 3,
        shading: { fill: "1A1A2E", type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [para([bold(title, { color: "FFFFFF", size: 22 })])]
      })
    ]
  });
}

// Term row
function termRow(abbr, fullForm, description, colWidths) {
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: colWidths[0], type: WidthType.DXA },
        margins: cellMargins,
        shading: { fill: "F8F8FC", type: ShadingType.CLEAR },
        children: [para([bold(abbr, { size: 22, color: "1A1A2E" })])]
      }),
      new TableCell({
        borders,
        width: { size: colWidths[1], type: WidthType.DXA },
        margins: cellMargins,
        children: [para([bold(fullForm, { size: 20 })])]
      }),
      new TableCell({
        borders,
        width: { size: colWidths[2], type: WidthType.DXA },
        margins: cellMargins,
        children: [para([text(description, { size: 20, color: "444444" })])]
      })
    ]
  });
}

const colWidths = [1400, 3200, 4760];
const tableWidth = colWidths.reduce((a, b) => a + b, 0);

// Header row
function headerRow() {
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: colWidths[0], type: WidthType.DXA },
        shading: { fill: "2D2D5E", type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [para([bold("Term", { color: "FFFFFF", size: 20 })])]
      }),
      new TableCell({
        borders,
        width: { size: colWidths[1], type: WidthType.DXA },
        shading: { fill: "2D2D5E", type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [para([bold("Full Form", { color: "FFFFFF", size: 20 })])]
      }),
      new TableCell({
        borders,
        width: { size: colWidths[2], type: WidthType.DXA },
        shading: { fill: "2D2D5E", type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [para([bold("Description", { color: "FFFFFF", size: 20 })])]
      })
    ]
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1A1A2E" },
        paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2D2D5E" },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
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
        children: [para([
          text("OLBRAIN", { bold: true, size: 16, color: "999999", font: "Arial" }),
          text("  |  Glossary of Terms  |  Confidential", { size: 16, color: "999999", font: "Arial" })
        ])]
      })
    },
    footers: {
      default: new Footer({
        children: [para([
          text("Olbrain Labs Private Limited  |  olbrain.com  |  Page ", { size: 16, color: "999999" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" })
        ], { alignment: AlignmentType.CENTER })]
      })
    },
    children: [
      // Title
      para([bold("OLBRAIN", { size: 44, color: "1A1A2E" })], { alignment: AlignmentType.CENTER }),
      para([text("The Machine Brain", { size: 24, color: "666666", italics: true })], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
      para([bold("Glossary of Architecture & Business Terms", { size: 28, color: "2D2D5E" })], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
      para([text("Prepared for Campus Angels  |  February 2026", { size: 20, color: "888888" })], { alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

      // Main glossary table
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [
          headerRow(),

          // --- CORE TECHNOLOGY ---
          sectionRow("CORE TECHNOLOGY", colWidths),

          termRow("CS",
            "Cognitive Substrate",
            "Olbrain\u2019s foundational technology layer that gives AI agents persistent Identity. It is the \u201COS\u201D for agent intelligence \u2014 managing memory, beliefs, personality, and continuity across interactions.",
            colWidths),

          termRow("CoF",
            "Core Objective Function",
            "The deep purpose driving each agent. For a business agent, the CoF is to represent and grow that specific business. It anchors all decisions the agent makes.",
            colWidths),

          termRow("CNE",
            "Coherent Narrative Exclusivity",
            "Olbrain\u2019s patent-pending Identity protocol with three pillars: Coherence (no self-contradiction), Narrative Continuity (evolving world model), and Exclusivity (non-replicable identity).",
            colWidths),

          termRow("GNF",
            "Global Narrative Frame",
            "A graph-structured record tracking an agent\u2019s entire narrative over time. Ensures each agent maintains a unique, non-replicable identity that cannot be copied or forked.",
            colWidths),

          termRow("RbR",
            "Recursive Belief Revision",
            "The Coherence mechanism. When an agent encounters contradictory information, RbR updates and compresses beliefs logically so the agent never contradicts itself.",
            colWidths),

          termRow("Umwelt",
            "Dynamic World Model",
            "Each agent\u2019s living, CoF-structured understanding of its environment \u2014 the business, its customers, and their relationships. Not a static database but an evolving model.",
            colWidths),

          termRow("eA\u00B3",
            "epistemic Autonomy, Accountability & Alignment",
            "The structural integrity framework enabling agents to act as reliable, trustworthy partners rather than stateless prompt-response machines.",
            colWidths),

          termRow("TLC",
            "Trust, Loyalty, Care",
            "Core values built into every Olbrain agent. Trust (honest, transparent), Loyalty (acts in customer\u2019s interest), Care (warm but professional).",
            colWidths),

          // --- PLATFORM ARCHITECTURE ---
          sectionRow("PLATFORM ARCHITECTURE", colWidths),

          termRow("RAG",
            "Retrieval Augmented Generation",
            "AI technique where the agent retrieves relevant documents from an indexed Knowledge Base before generating responses. Ensures answers are grounded in real business data.",
            colWidths),

          termRow("MCP",
            "Model Context Protocol",
            "An open standard for connecting AI agents to external tools (CRMs, databases, APIs). Olbrain\u2019s Tool Manager uses MCP to give agents operational capabilities.",
            colWidths),

          termRow("LLM",
            "Large Language Model",
            "The reasoning engine (e.g., GPT, Claude, Gemini). In Olbrain\u2019s analogy: the LLM is the Neo Cortex (reasoning), Olbrain\u2019s CS is the Old Brain (identity).",
            colWidths),

          termRow("CS Cloud",
            "Cognitive Substrate Cloud",
            "Olbrain\u2019s cloud infrastructure where agent identities are hosted and managed. The deployment environment for all Olbrain agents.",
            colWidths),

          termRow("Agent Bridge",
            "Channel Deployment Layer",
            "The layer that connects an Olbrain agent to communication channels (WhatsApp, web chat, Tiledesk). Handles message routing and channel-specific formatting.",
            colWidths),

          // --- BUSINESS & FINANCIAL ---
          sectionRow("BUSINESS & FINANCIAL TERMS", colWidths),

          termRow("CPaaS",
            "Communications Platform as a Service",
            "Cloud-based platforms enabling businesses to add communication features (SMS, WhatsApp, voice). Olbrain\u2019s GTM Phase 1 partners with Sinch (CPaaS leader).",
            colWidths),

          termRow("ARR",
            "Annual Recurring Revenue",
            "Annualised subscription revenue. Olbrain projects ARR growing from $0.08M (2026) to $8.55M (2028).",
            colWidths),

          termRow("TAM",
            "Total Addressable Market",
            "The total global market opportunity. Olbrain\u2019s TAM: $1.2 Trillion (AI agent market).",
            colWidths),

          termRow("SAM",
            "Serviceable Addressable Market",
            "The segment Olbrain can realistically serve. $32B at 47% CAGR.",
            colWidths),

          termRow("SOM",
            "Serviceable Obtainable Market",
            "The portion Olbrain targets to capture. $1B by 2028.",
            colWidths),

          termRow("GTM",
            "Go-To-Market",
            "Market entry strategy. Olbrain\u2019s 3-phase GTM: 2025 CPaaS (Sinch), 2026 Developer (Studio beta), 2027 Scale globally.",
            colWidths),

          termRow("D2C",
            "Direct to Consumer",
            "Brands selling directly to end customers (not through retailers). A key Olbrain target segment for WhatsApp agents.",
            colWidths),

          termRow("G&A",
            "General & Administrative",
            "Operating expenses like rent, legal, insurance. 8% of Olbrain\u2019s planned burn allocation.",
            colWidths),

          // --- VISION ---
          sectionRow("VISION & LONG-TERM", colWidths),

          termRow("AGI",
            "Artificial General Intelligence",
            "AI with human-level reasoning across domains. Olbrain has been researching AGI since 2017 and is recognised among top global AGI startups.",
            colWidths),

          termRow("Machine Brain",
            "Olbrain\u2019s Identity Layer",
            "Phase 1 vision (by 2027). Software-based digital agents with persistent Identity for businesses on WhatsApp, web, and apps.",
            colWidths),

          termRow("Cybernetic Brain",
            "Embodied Agent Substrate",
            "Phase 2 vision (by 2032). Agents inhabiting physical bodies (robots, devices, vehicles) while maintaining their Identity.",
            colWidths),

          termRow("Positronic Brain",
            "Space-Grade Agent Substrate",
            "Phase 3 vision (by 2042). Analogue, space-grade agents for robotic colonisation of space (Robolization).",
            colWidths),
        ]
      }),

      // Footer note
      para("", { spacing: { before: 300 } }),
      para([italic("This glossary accompanies the Olbrain Investment Pitch v2.6. For questions, contact Alok Gotam at alok@olbrain.com or wa.me/917897057481", { size: 18, color: "888888" })], { alignment: AlignmentType.CENTER }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/sessions/blissful-determined-brown/mnt/mindclone/Olbrain_Glossary_Campus_Angels.docx', buffer);
  console.log('Glossary generated successfully!');
});
