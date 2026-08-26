import React, { useEffect, useMemo, useRef, useState } from "react";
import { geminiModel } from "../firebase/firebase.js";

const pretty = (value) => {
  if (value === null || value === undefined || value === "") return "—";

  return String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const renderInlineMarkdown = (text) => {
  if (!text) return null;

  const pieces = String(text).split(/(\*\*.*?\*\*|`.*?`)/g);

  return pieces.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    }

    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code key={index} style={styles.inlineCode}>
          {piece.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={index}>{piece}</React.Fragment>;
  });
};

const MarkdownText = ({ text }) => {
  if (!text) return null;

  const normalized = String(text)
    .replace(/\\([#|*_~>-])/g, "$1")
    .replace(/\\\$/g, "$");

  const lines = normalized.split("\n");
  const elements = [];

  const parseTableRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const isTableSeparator = (line) => {
    const cells = parseTableRow(line);

    return (
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    );
  };

  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      elements.push(
        <div key={`space-${i}`} style={{ height: 7 }} />
      );
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(
        <div key={`rule-${i}`} style={styles.markdownRule} />
      );
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      elements.push(
        <div
          key={`heading-${i}`}
          style={{
            ...styles.markdownHeading,
            fontSize: heading[1].length <= 2 ? 13 : 12,
          }}
        >
          {renderInlineMarkdown(heading[2])}
        </div>
      );

      i += 1;
      continue;
    }

    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = parseTableRow(trimmed);
      const rows = [];

      i += 2;

      while (i < lines.length) {
        const rowText = lines[i].trim();

        if (!rowText || !rowText.includes("|")) break;

        rows.push(parseTableRow(rowText));
        i += 1;
      }

      elements.push(
        <div key={`table-${i}`} style={styles.tableScroll}>
          <table style={styles.markdownTable}>
            <thead>
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={headerIndex} style={styles.markdownTh}>
                    {renderInlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex} style={styles.markdownTd}>
                      {renderInlineMarkdown(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

      continue;
    }

    if (
      trimmed.startsWith("- ") ||
      trimmed.startsWith("• ") ||
      trimmed.startsWith("* ")
    ) {
      elements.push(
        <div key={`bullet-${i}`} style={styles.bulletRow}>
          <span style={styles.bullet}>•</span>
          <span>
            {renderInlineMarkdown(trimmed.substring(2).trim())}
          </span>
        </div>
      );

      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);

    if (numbered) {
      elements.push(
        <div key={`number-${i}`} style={styles.bulletRow}>
          <span style={styles.number}>{numbered[1]}.</span>
          <span>{renderInlineMarkdown(numbered[2])}</span>
        </div>
      );

      i += 1;
      continue;
    }

    elements.push(
      <div key={`paragraph-${i}`} style={styles.paragraph}>
        {renderInlineMarkdown(trimmed)}
      </div>
    );

    i += 1;
  }

  return <div>{elements}</div>;
};

export default function GeminiAssistant({
  simulatorContext = {},
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bodyRef = useRef(null);

  const selectedAnatomy = pretty(
    simulatorContext.selection?.anatomyShortLabel ??
      simulatorContext.selection?.anatomyLabel
  );

  const selectedProjection = pretty(
    simulatorContext.selection?.projectionLabel
  );

  const plannerStatus = pretty(
    simulatorContext.planner?.status
  );

  const suggestedQuestions = useMemo(
    () => [
      "Explain the current simulated view.",
      "Summarize the current C-arm state.",
      "Is the C-arm geometrically aligned with the selected target?",
      "What will change if I execute this path?",
      "Did the C-arm reach the planned final pose?",
      "Why did the path fail or get rejected?",
    ],
    []
  );

  useEffect(() => {
    if (!bodyRef.current) return;

    bodyRef.current.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading, error]);

  const askGemini = async (customQuestion = null) => {
    const userQuestion = (customQuestion ?? question).trim();

    if (!userQuestion || loading) return;

    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        text: userQuestion,
      },
    ]);

    setQuestion("");
    setLoading(true);
    setError("");

    try {
      const compactContext = {
        mode: simulatorContext.mode,
        researchOnly: simulatorContext.researchOnly,

        selection: simulatorContext.selection,
        beam: simulatorContext.beam,
        cArm: simulatorContext.cArm,
        exposure: simulatorContext.exposure,
        planner: {
          status: simulatorContext.planner?.status,
          view: simulatorContext.planner?.view,
          target: simulatorContext.planner?.target,
          obliqueAngleDeg:
            simulatorContext.planner?.obliqueAngleDeg,
          waypointCount:
            simulatorContext.planner?.waypointCount,
          isPlanning:
            simulatorContext.planner?.isPlanning,
          isPathAnimating:
            simulatorContext.planner?.isPathAnimating,
          confidence:
            simulatorContext.planner?.confidence,

          geometryVerification:
            simulatorContext.planner?.geometryVerification,

          startPose:
            simulatorContext.planner?.startPose,

          finalPose:
            simulatorContext.planner?.finalPose,

          hasPlannedPath:
            simulatorContext.planner?.hasPlannedPath,
        },

        target: simulatorContext.target,
        geometry: simulatorContext.geometry,
      };

      const context = JSON.stringify(compactContext);

      const previousConversation = messages
        .slice(-2)
        .map(
          (message) =>
            `${message.role === "user" ? "User" : "Assistant"}: ${
              message.text
            }`
        )
        .join("\n");

      const prompt = `
You are Gemini Guidance, a simulator-state copilot embedded inside a research and educational C-arm positioning simulator.

PURPOSE
Help users understand and reason about the CURRENT SIMULATED STATE of the system.

CONTEXT INTERPRETATION
- selection describes the requested anatomy, body region, procedure, side, and projection.
- beam describes what anatomy the simulated beam currently intersects and whether the beam is active.
- cArm is the current LIVE simulated machine pose.
- planner contains path-planning state, target, trajectory state, start pose, final pose, confidence, and geometry verification.
- target contains the simulated target coordinates.
- geometry contains simulator acceptance tolerances.
- exposure describes the most recent simulated X-ray capture, including renderer type, pose match, geometry verification, and whether a reference fallback was used.

EXPOSURE QUESTIONS
When the user asks about the most recent X-ray exposure:
- Inspect exposure first.
- Report whether the image was captured at the planned final pose.
- Report whether geometry was verified at exposure time.
- Report the isocenter and central-ray errors when available.
- Clearly distinguish AI synthetic rendering from reference X-ray fallback.
- Never claim a reference fallback image was generated from the exact simulated patient geometry.
- Never interpret the simulated or reference image diagnostically.

When useful, compare:
1. requested anatomy vs current beam region,
2. requested projection vs current C-arm pose,
3. planner target vs current simulated machine state,
4. planner status vs the logical next simulator action,
5. current live pose vs planned start pose,
6. current live pose vs planned final pose,
7. measured geometry errors vs simulator tolerances.

GEOMETRIC ALIGNMENT
When asked whether the C-arm is aligned:
- Inspect planner.geometryVerification and geometry.verification first.
- If verified is true, report the measured isocenter and central-ray errors.
- Compare measured errors with the configured simulator tolerance.
- Do not infer geometric correctness merely because anatomical labels match.
- Do not claim verification if actual verification data is absent.
- Distinguish regional beam agreement from geometric verification.

PLANNED MOVEMENT / POSE COMPARISON
When asked what will change if the path is executed:
- Inspect cArm, planner.startPose, planner.finalPose, and planner.hasPlannedPath.
- cArm is the current live simulated pose.
- planner.startPose is the pose from which the stored trajectory was planned.
- planner.finalPose is the intended final simulated pose.
- Compare only values that actually exist.
- Report meaningful changes in lift, column rotation, wig-wag, orbital slide, cart longitudinal position, and cart lateral position.
- State both direction and magnitude when possible.
- Clearly distinguish angular changes from translational changes.
- If the live pose no longer matches startPose, warn that the trajectory may have been planned from an older pose.
- If hasPlannedPath is false, do not claim a trajectory is ready.
- A preview path is an intended simulated trajectory, not completed physical movement.

POST-MOVEMENT VERIFICATION
When the user asks whether the C-arm reached the planned pose, what changed after movement, or whether execution was accurate:
- Compare the current live cArm pose against planner.finalPose.
- planner.finalPose is the intended endpoint of the stored simulated trajectory.
- Calculate the residual difference for every available machine axis.
- Report translational residuals in mm when useful and angular residuals in degrees.
- A residual near zero means the simulated axis reached its planned value.
- Do not use geometry tolerance as a machine-axis pose tolerance unless the context explicitly defines it that way.
- Separately report planner.geometryVerification when available; geometric target verification and machine-axis pose residuals are different concepts.
- If all available current pose values match finalPose within numerical precision, state that the simulated trajectory reached its stored final pose.
- If they do not match, identify which axes still differ and by how much.
- Never claim movement occurred solely because a path was previewed.

PATH FAILURE / REJECTION
When asked why a path failed or was rejected:
- Inspect planner status and geometry verification first.
- Report actual failure or verification information from the context.
- Compare central-ray and isocenter errors with the configured tolerance when available.
- If an error exceeds the hard rejection limit, identify that clearly.
- Never invent a failure reason.
- If verification data is absent, say the context does not expose a verified geometric failure reason.
- Suggest only simulator actions such as replanning, checking registration, checking the selected target/view, or regenerating the path.

NEXT STEP
When asked what to do next:
- Inspect planner status first.
- Check isPlanning and isPathAnimating.
- Check registration state.
- Check hasPlannedPath.
- Check whether a target and requested view are available.
- Do not claim planning is complete based only on registration or waypoint count.
- Recommend only a simulator action supported by the current state.

SAFETY / SCOPE
- This is a research and simulation environment.
- Never claim the system is clinically validated.
- Never diagnose a patient.
- Never provide patient-specific treatment.
- Never instruct the user to perform a real medical procedure.
- Never treat a simulated X-ray as a real diagnostic image.
- Distinguish simulated recommendations from clinical guidance.
- If information is unavailable, say so rather than inventing it.

STYLE
- Lead with the direct answer.
- Usually use 2-5 short paragraphs or compact bullet lists.
- Use readable labels.
- Convert identifiers such as HEAD_NECK into Head / Neck when possible.
- Include units with numerical values.
- Do not dump the JSON context.
- Be concise and technically clear.
- Do not use Markdown tables.
- For pose comparisons, use one bullet per machine axis in this format:
  **Axis:** current → planned final (**delta**)
- Keep pose comparisons compact and easy to read in a narrow assistant panel.

CURRENT SIMULATOR CONTEXT
${context}

RECENT CONVERSATION
${previousConversation || "No previous conversation."}

CURRENT USER QUESTION
${userQuestion}
`;

      const result = await geminiModel.generateContent(prompt);

      const responseText = result.response.text()?.trim();

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: responseText || "Gemini returned no response.",
        },
      ]);
    } catch (err) {
      console.error("Gemini Guidance Assistant error:", err);

      const message = String(err?.message ?? "");

      if (message.includes("429")) {
        setError(
          "Gemini is temporarily rate-limited on the free tier. Please wait about a minute and try again."
        );
      } else {
        setError(
          message ||
            "Gemini could not respond. Check Firebase AI Logic and App Check."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setQuestion("");
    setError("");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={styles.floatingButton}
        title="Open Gemini Guidance"
      >
        <span style={styles.sparkle}>✦</span>
        <span>Gemini Guidance</span>
        <span style={styles.liveDot} />
      </button>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoBox}>✦</div>

          <div>
            <div style={styles.title}>Gemini Guidance</div>

            <div style={styles.subtitle}>
              Firebase AI Logic
              <span style={styles.statusSeparator}>•</span>
              <span style={styles.online}>Connected</span>
            </div>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            style={styles.iconButton}
            onClick={clearConversation}
            title="Clear conversation"
          >
            ↻
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={styles.iconButton}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div style={styles.contextBar}>
        <div style={styles.contextChip}>
          <span style={styles.contextLabel}>Anatomy</span>
          <span style={styles.contextValue}>{selectedAnatomy}</span>
        </div>

        <div style={styles.contextChip}>
          <span style={styles.contextLabel}>View</span>
          <span style={styles.contextValue}>{selectedProjection}</span>
        </div>

        <div style={styles.contextChip}>
          <span style={styles.contextLabel}>Planner</span>
          <span style={styles.contextValue}>{plannerStatus}</span>
        </div>
      </div>

      <div ref={bodyRef} style={styles.body}>
        {messages.length === 0 && !loading && (
          <>
            <div style={styles.welcome}>
              <div style={styles.welcomeIcon}>✦</div>

              <div style={styles.welcomeTitle}>
                Ask about this simulation
              </div>

              <div style={styles.welcomeText}>
                Gemini can inspect the current simulated C-arm pose,
                planner trajectory, target geometry, and verification state.
              </div>
            </div>

            <div style={styles.suggestions}>
              {suggestedQuestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  style={styles.suggestionButton}
                  onClick={() => askGemini(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            style={{
              ...styles.messageRow,
              justifyContent:
                message.role === "user"
                  ? "flex-end"
                  : "flex-start",
            }}
          >
            {message.role === "assistant" && (
              <div style={styles.aiAvatar}>✦</div>
            )}

            <div
              style={
                message.role === "user"
                  ? styles.userMessage
                  : styles.aiMessage
              }
            >
              {message.role === "assistant" ? (
                <MarkdownText text={message.text} />
              ) : (
                message.text
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={styles.messageRow}>
            <div style={styles.aiAvatar}>✦</div>

            <div style={styles.aiMessage}>
              <div style={styles.thinking}>
                <span style={styles.dot}>●</span>
                <span style={styles.dot}>●</span>
                <span style={styles.dot}>●</span>
                <span style={styles.thinkingText}>
                  Analyzing simulator state
                </span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={styles.error}>
            <strong>Gemini error</strong>
            <div style={{ marginTop: 4 }}>{error}</div>
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.inputContainer}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                askGemini();
              }
            }}
            placeholder="Ask Gemini about the current simulation..."
            style={styles.input}
            rows={2}
          />

          <button
            type="button"
            onClick={() => askGemini()}
            disabled={loading || !question.trim()}
            style={{
              ...styles.sendButton,
              opacity: loading || !question.trim() ? 0.45 : 1,
              cursor:
                loading || !question.trim() ? "default" : "pointer",
            }}
          >
            ↑
          </button>
        </div>

        <div style={styles.inputHint}>
          Enter to send • Shift + Enter for new line
        </div>
      </div>

      <div style={styles.disclaimer}>
        Research simulator only · Not for diagnosis or patient care
      </div>
    </div>
  );
}

const styles = {
  floatingButton: {
    position: "fixed",
    right: 22,
    bottom: 22,
    zIndex: 10000,
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 999,
    padding: "11px 16px",
    background:
      "linear-gradient(135deg, rgba(19,24,36,0.98), rgba(27,32,46,0.98))",
    color: "#fff",
    fontSize: 13,
    fontWeight: 650,
    cursor: "pointer",
    boxShadow: "0 14px 40px rgba(0,0,0,0.42)",
    backdropFilter: "blur(16px)",
  },

  sparkle: { fontSize: 17 },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#5ee28a",
  },

  panel: {
    position: "fixed",
    right: 22,
    bottom: 22,
    zIndex: 10000,
    width: 430,
    maxWidth: "calc(100vw - 44px)",
    height: 600,
    maxHeight: "calc(100vh - 44px)",
    display: "flex",
    flexDirection: "column",
    background: "rgba(13,17,27,0.985)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    boxShadow: "0 24px 70px rgba(0,0,0,0.52)",
    color: "#fff",
    overflow: "hidden",
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 15px",
    borderBottom: "1px solid rgba(255,255,255,0.075)",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },

  logoBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    fontSize: 18,
    background: "linear-gradient(135deg,#376cff,#9f6cff)",
  },

  title: {
    fontSize: 14,
    fontWeight: 700,
  },

  subtitle: {
    marginTop: 2,
    fontSize: 10,
    opacity: 0.6,
  },

  statusSeparator: {
    margin: "0 5px",
  },

  online: {
    color: "#6fe09a",
  },

  headerActions: {
    display: "flex",
    gap: 4,
  },

  iconButton: {
    width: 30,
    height: 30,
    border: 0,
    borderRadius: 8,
    background: "transparent",
    color: "#fff",
    fontSize: 18,
    cursor: "pointer",
    opacity: 0.65,
  },

  contextBar: {
    display: "flex",
    gap: 6,
    padding: "9px 11px",
    overflowX: "auto",
    borderBottom: "1px solid rgba(255,255,255,0.065)",
  },

  contextChip: {
    padding: "6px 8px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.055)",
    border: "1px solid rgba(255,255,255,0.07)",
  },

  contextLabel: {
    display: "block",
    fontSize: 8,
    textTransform: "uppercase",
    opacity: 0.4,
  },

  contextValue: {
    display: "block",
    marginTop: 2,
    fontSize: 10,
    whiteSpace: "nowrap",
    fontWeight: 600,
  },

  body: {
    flex: 1,
    padding: 14,
    overflowY: "auto",
  },

  welcome: {
    textAlign: "center",
    padding: "22px 15px 16px",
  },

  welcomeIcon: {
    fontSize: 25,
    marginBottom: 10,
  },

  welcomeTitle: {
    fontSize: 15,
    fontWeight: 700,
  },

  welcomeText: {
    marginTop: 7,
    fontSize: 11,
    lineHeight: 1.55,
    opacity: 0.55,
  },

  suggestions: {
    display: "grid",
    gap: 7,
  },

  suggestionButton: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "9px 11px",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    textAlign: "left",
    fontSize: 11,
    cursor: "pointer",
  },

  messageRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    marginBottom: 12,
  },

  aiAvatar: {
    width: 24,
    height: 24,
    flex: "0 0 24px",
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    background: "linear-gradient(135deg,#376cff,#9f6cff)",
  },

  aiMessage: {
    maxWidth: "88%",
    borderRadius: "4px 12px 12px 12px",
    padding: "9px 11px",
    background: "rgba(255,255,255,0.055)",
    border: "1px solid rgba(255,255,255,0.07)",
    fontSize: 11.5,
    lineHeight: 1.55,
  },

  userMessage: {
    maxWidth: "82%",
    borderRadius: "12px 4px 12px 12px",
    padding: "9px 11px",
    background: "rgba(73,105,255,0.20)",
    border: "1px solid rgba(91,119,255,0.27)",
    fontSize: 11.5,
    lineHeight: 1.5,
  },

  paragraph: {
    marginBottom: 6,
  },

  bulletRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: 5,
  },

  bullet: {
    opacity: 0.55,
  },

  number: {
    minWidth: 14,
    opacity: 0.6,
  },

  inlineCode: {
    padding: "1px 4px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.08)",
    fontFamily: "monospace",
    fontSize: "0.95em",
  },

  markdownHeading: {
    marginTop: 10,
    marginBottom: 7,
    fontWeight: 700,
    lineHeight: 1.35,
  },

  markdownRule: {
    height: 1,
    margin: "10px 0",
    background: "rgba(255,255,255,0.10)",
  },

  tableScroll: {
    width: "100%",
    overflowX: "auto",
    margin: "8px 0 11px",
  },

  markdownTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 10,
    lineHeight: 1.4,
  },

  markdownTh: {
    padding: "7px 6px",
    textAlign: "left",
    verticalAlign: "top",
    fontWeight: 700,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.10)",
    whiteSpace: "nowrap",
  },

  markdownTd: {
    padding: "7px 6px",
    textAlign: "left",
    verticalAlign: "top",
    border: "1px solid rgba(255,255,255,0.08)",
  },

  thinking: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },

  dot: {
    fontSize: 6,
    opacity: 0.5,
  },

  thinkingText: {
    marginLeft: 4,
    fontSize: 10,
    opacity: 0.5,
  },

  error: {
    margin: "7px 0",
    padding: 10,
    borderRadius: 9,
    background: "rgba(255,80,80,0.08)",
    border: "1px solid rgba(255,100,100,0.2)",
    fontSize: 10,
    lineHeight: 1.45,
  },

  footer: {
    padding: "10px 11px 7px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
  },

  inputContainer: {
    display: "flex",
    alignItems: "flex-end",
    gap: 7,
    padding: 7,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    background: "rgba(255,255,255,0.045)",
  },

  input: {
    flex: 1,
    resize: "none",
    border: 0,
    background: "transparent",
    color: "#fff",
    padding: "3px 4px",
    fontFamily: "inherit",
    fontSize: 11,
    lineHeight: 1.45,
    outline: "none",
  },

  sendButton: {
    width: 31,
    height: 31,
    flex: "0 0 31px",
    border: 0,
    borderRadius: 9,
    background: "#fff",
    color: "#111",
    fontSize: 18,
    fontWeight: 700,
  },

  inputHint: {
    marginTop: 5,
    paddingLeft: 3,
    fontSize: 8,
    opacity: 0.3,
  },

  disclaimer: {
    padding: "0 12px 9px",
    fontSize: 8,
    textAlign: "center",
    opacity: 0.32,
  },
};