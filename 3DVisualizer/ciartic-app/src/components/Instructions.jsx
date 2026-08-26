import React, { useState } from 'react';

const Instructions = ({ onClose }) => {
    const [page, setPage] = useState(0);

    const pages = [
        {
            title: "C-Arm Guidance Simulator",
            badge: "WELCOME",
            content: (
                <>
                    <p>
                        This simulator demonstrates an AI-guided workflow for
                        planning and reproducing C-arm imaging positions.
                    </p>

                    <p>
                        The system combines anatomical landmark targeting,
                        projection selection, geometric path planning,
                        simulated C-arm motion, and X-ray reference imaging.
                    </p>

                    <div style={calloutStyle}>
                        <strong>Recommended workflow</strong><br />
                        Select Target → Preview Path → Move C-Arm → Expose X-Ray
                    </div>

                    <p style={warningStyle}>
                        Research and simulation environment only. Not for
                        diagnostic or clinical use.
                    </p>
                </>
            )
        },

        {
            title: "1. Select the Imaging Target",
            badge: "TARGET",
            content: (
                <>
                    <p>
                        Start with the <strong>AI Path Planner</strong>.
                    </p>

                    <p>
                        Select the required procedure, anatomical region,
                        landmark, and imaging projection.
                    </p>

                    <div style={stepStyle}>
                        <strong>Procedure</strong><br />
                        Choose the type of imaging workflow.
                    </div>

                    <div style={stepStyle}>
                        <strong>Anatomical Target</strong><br />
                        Select the landmark that should be positioned at the
                        imaging isocenter.
                    </div>

                    <div style={stepStyle}>
                        <strong>Projection</strong><br />
                        Choose AP, lateral, oblique, cranial, caudal, or another
                        available projection.
                    </div>

                    <p>
                        For oblique views, adjust the requested angle when the
                        control is available.
                    </p>
                </>
            )
        },

        {
            title: "2. Preview the Planned Path",
            badge: "PLAN",
            content: (
                <>
                    <p>
                        Press <strong>PREVIEW PATH</strong> before moving the
                        simulated C-arm.
                    </p>

                    <p>
                        The planner calculates a trajectory from the current
                        machine pose to the requested imaging pose.
                    </p>

                    <div style={calloutStyle}>
                        The preview lets you inspect the planned motion before
                        commanding the C-arm to move.
                    </div>

                    <p>
                        Review the target, requested projection, path, and final
                        pose before continuing.
                    </p>
                </>
            )
        },

        {
            title: "3. Move the C-Arm",
            badge: "MOVE",
            content: (
                <>
                    <p>
                        After reviewing the planned trajectory, press
                        <strong> MOVE C-ARM</strong>.
                    </p>

                    <p>
                        The simulator follows the generated waypoints until the
                        planned final pose is reached.
                    </p>

                    <div style={stepStyle}>
                        <strong>During movement</strong><br />
                        The cart and C-arm joints update according to the
                        planned trajectory.
                    </div>

                    <div style={stepStyle}>
                        <strong>At arrival</strong><br />
                        The simulator checks the achieved pose against the
                        planned imaging geometry.
                    </div>

                    <p>
                        Do not use the exposure result as evidence of correct
                        positioning unless the simulator reports the geometry
                        as verified.
                    </p>
                </>
            )
        },

        {
            title: "4. Geometry Verification",
            badge: "VERIFY",
            content: (
                <>
                    <p>
                        Before exposure, the simulator evaluates whether the
                        C-arm has reached the intended imaging geometry.
                    </p>

                    <div style={stepStyle}>
                        <strong>Pose Match</strong><br />
                        Confirms that the machine reached the planned final pose.
                    </div>

                    <div style={stepStyle}>
                        <strong>Isocenter Error</strong><br />
                        Measures how closely the selected anatomical target is
                        aligned with the planned imaging isocenter.
                    </div>

                    <div style={stepStyle}>
                        <strong>Central-Ray Error</strong><br />
                        Evaluates alignment of the simulated X-ray beam with
                        the requested target geometry.
                    </div>

                    <div style={calloutStyle}>
                        A verified geometry result means the simulated pose
                        satisfies the configured geometric tolerances.
                    </div>
                </>
            )
        },

        {
            title: "5. Expose X-Ray",
            badge: "EXPOSE",
            content: (
                <>
                    <p>
                        Once the planned pose has been reached, press
                        <strong> EXPOSE X-RAY</strong>.
                    </p>

                    <p>
                        For supported anatomy/projection combinations, the
                        simulator displays the corresponding validated
                        reference X-ray from the reference dataset.
                    </p>

                    <div style={stepStyle}>
                        <strong>Reference image available</strong><br />
                        The matching reference projection is displayed in the
                        X-ray monitor.
                    </div>

                    <div style={stepStyle}>
                        <strong>No reference image</strong><br />
                        Some projections may have valid planned geometry but no
                        matching image in the current reference dataset. The
                        simulator will clearly report that no reference image
                        is available.
                    </div>

                    <p style={warningStyle}>
                        A reference X-ray is not a patient-specific diagnostic
                        image and should not be interpreted as one.
                    </p>
                </>
            )
        },

        {
            title: "6. Manual Controls & Navigation",
            badge: "CONTROL",
            content: (
                <>
                    <p>
                        The simulator can also be explored manually using the
                        3D camera and C-arm controls.
                    </p>

                    <div style={stepStyle}>
                        <strong>Mouse</strong><br />
                        Left drag: Rotate view<br />
                        Right drag: Pan<br />
                        Scroll: Zoom
                    </div>

                    <div style={stepStyle}>
                        <strong>C-Arm Controls</strong><br />
                        Manual controls can adjust cart position, lift, column
                        rotation, wig-wag, and orbital motion.
                    </div>

                    <p>
                        Manual positioning is useful for testing and debugging,
                        while the planner workflow should be used when
                        evaluating planned target positioning.
                    </p>
                </>
            )
        },

        {
            title: "7. Overlays & Keyboard Shortcuts",
            badge: "TOOLS",
            content: (
                <>
                    <p>
                        Several visualization and debugging tools are available.
                    </p>

                    <div style={shortcutStyle}>
                        <kbd>I</kbd>
                        <span>Open / close these instructions</span>
                    </div>

                    <div style={shortcutStyle}>
                        <kbd>P</kbd>
                        <span>Toggle patient visibility</span>
                    </div>

                    <div style={shortcutStyle}>
                        <kbd>L</kbd>
                        <span>Toggle anatomical landmarks</span>
                    </div>

                    <div style={shortcutStyle}>
                        <kbd>D</kbd>
                        <span>Toggle debug visualization</span>
                    </div>

                    <div style={shortcutStyle}>
                        <kbd>C</kbd>
                        <span>Connect / disconnect supported external hardware</span>
                    </div>

                    <p>
                        Debug information can be used to inspect spatial
                        geometry and simulator state during development.
                    </p>
                </>
            )
        },

        {
            title: "8. Gemini Guidance",
            badge: "AI",
            content: (
                <>
                    <p>
                        The simulator includes a Gemini guidance assistant for
                        interacting with the current simulation state.
                    </p>

                    <p>
                        You can use it to ask about the selected anatomy,
                        projection, planned pose, geometry verification, and
                        the most recent simulated exposure.
                    </p>

                    <div style={calloutStyle}>
                        Example: Ask whether the last X-ray was captured at the
                        verified planned pose and which renderer or reference
                        source produced it.
                    </div>

                    <p>
                        AI-generated explanations are supporting information
                        for the research simulator and are not clinical advice.
                    </p>
                </>
            )
        },

        {
            title: "Ready",
            badge: "START",
            content: (
                <>
                    <p>
                        The simulator is ready.
                    </p>

                    <div style={workflowStyle}>
                        <span>1</span> Select anatomy & projection
                    </div>

                    <div style={workflowStyle}>
                        <span>2</span> Preview the path
                    </div>

                    <div style={workflowStyle}>
                        <span>3</span> Review the planned pose
                    </div>

                    <div style={workflowStyle}>
                        <span>4</span> Move the C-arm
                    </div>

                    <div style={workflowStyle}>
                        <span>5</span> Verify geometry
                    </div>

                    <div style={workflowStyle}>
                        <span>6</span> Expose X-ray
                    </div>

                    <p style={{
                        marginTop: '24px',
                        color: '#94a3b8'
                    }}>
                        Press <strong>I</strong> at any time to reopen these
                        instructions.
                    </p>
                </>
            )
        }
    ];

    const current = pages[page];

    const bg = '#111827';
    const panel = '#172033';
    const panel2 = '#0f172a';
    const border = 'rgba(148, 163, 184, 0.18)';
    const text = '#e5e7eb';
    const muted = '#94a3b8';
    const blue = '#60a5fa';

    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2, 6, 23, 0.82)',
            backdropFilter: 'blur(10px)',
            padding: '20px'
        }}>
            <div style={{
                width: '900px',
                maxWidth: '96vw',
                height: '620px',
                maxHeight: '92vh',
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: '20px',
                boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                color: text,
                fontFamily: 'Inter, system-ui, sans-serif'
            }}>

                {/* HEADER */}
                <div style={{
                    padding: '24px 28px',
                    borderBottom: `1px solid ${border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: panel2
                }}>
                    <div>
                        <div style={{
                            color: blue,
                            fontSize: '11px',
                            letterSpacing: '2px',
                            fontWeight: 800,
                            marginBottom: '7px'
                        }}>
                            {current.badge}
                        </div>

                        <h2 style={{
                            margin: 0,
                            fontSize: '25px',
                            fontWeight: 750
                        }}>
                            {current.title}
                        </h2>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            border: `1px solid ${border}`,
                            background: panel,
                            color: muted,
                            cursor: 'pointer',
                            fontSize: '18px'
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* BODY */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '30px 34px',
                    fontSize: '16px',
                    lineHeight: 1.7
                }}>
                    {current.content}
                </div>

                {/* FOOTER */}
                <div style={{
                    padding: '18px 28px',
                    borderTop: `1px solid ${border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: panel2
                }}>

                    <div style={{
                        display: 'flex',
                        gap: '7px'
                    }}>
                        {pages.map((_, index) => (
                            <div
                                key={index}
                                style={{
                                    width: index === page ? '24px' : '7px',
                                    height: '7px',
                                    borderRadius: '10px',
                                    background:
                                        index === page
                                            ? blue
                                            : '#334155',
                                    transition: '0.2s'
                                }}
                            />
                        ))}
                    </div>

                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <span style={{
                            color: muted,
                            fontSize: '13px',
                            marginRight: '8px'
                        }}>
                            {page + 1} / {pages.length}
                        </span>

                        <button
                            disabled={page === 0}
                            onClick={() =>
                                setPage(p => Math.max(0, p - 1))
                            }
                            style={{
                                ...buttonStyle,
                                opacity: page === 0 ? 0.35 : 1,
                                cursor:
                                    page === 0
                                        ? 'not-allowed'
                                        : 'pointer'
                            }}
                        >
                            Back
                        </button>

                        {page < pages.length - 1 ? (
                            <button
                                onClick={() =>
                                    setPage(p =>
                                        Math.min(
                                            pages.length - 1,
                                            p + 1
                                        )
                                    )
                                }
                                style={{
                                    ...buttonStyle,
                                    background: '#2563eb',
                                    borderColor: '#3b82f6'
                                }}
                            >
                                Next →
                            </button>
                        ) : (
                            <button
                                onClick={onClose}
                                style={{
                                    ...buttonStyle,
                                    background: '#166534',
                                    borderColor: '#22c55e'
                                }}
                            >
                                Start Simulator
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const buttonStyle = {
    padding: '10px 18px',
    borderRadius: '9px',
    border: '1px solid rgba(148,163,184,0.25)',
    background: '#1e293b',
    color: '#f1f5f9',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer'
};

const stepStyle = {
    background: '#172033',
    border: '1px solid rgba(148,163,184,0.15)',
    borderRadius: '10px',
    padding: '14px 16px',
    margin: '12px 0'
};

const calloutStyle = {
    background: 'rgba(37,99,235,0.12)',
    border: '1px solid rgba(96,165,250,0.35)',
    borderRadius: '10px',
    padding: '15px 17px',
    margin: '16px 0',
    color: '#dbeafe'
};

const warningStyle = {
    background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.3)',
    color: '#fcd34d',
    borderRadius: '10px',
    padding: '14px 16px'
};

const shortcutStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    margin: '11px 0'
};

const workflowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '11px 0',
    borderBottom: '1px solid rgba(148,163,184,0.12)'
};

export default Instructions;