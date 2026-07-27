import React, { useState } from 'react';
import simOverviewImg from '../public/sim_overview.png';
import navigateImg from '../public/navigate.png';
import controlsPanelImg from '../public/controls_panel.png';
import realXrayExposeImg from '../public/real-xray-expose.png';
import keyboardLegendImg from '../public/keyboard_legend.png';
import debugModeImg from '../public/debugMode.png';
import debugOverlayImg from '../public/debugOverlay.png';
import prototypeImg from '../public/movePhysicalModel.gif';
import usbPlugImg from '../public/usbPlug.png';

const Instructions = ({ onClose }) => {
    const [page, setPage] = useState(0);

    const pages = [
        {
            title: "Welcome to CIARTIC Simulation",
            image: simOverviewImg,
            content: "This is a 3D medical simulation for C-arm guidance. You can use this app to simulate X-ray imaging and positioning."
        },
        {
            title: "Camera & Navigation",
            image: navigateImg,
            content: "Use your mouse to look around.\nLeft Click + Drag: Rotate camera\nRight Click + Drag: Pan camera\nScroll Wheel: Zoom in/out"
        },
        {
            title: "C-Arm Controls",
            image: controlsPanelImg,
            content: (
                <>
                    Use the control panel on the right to adjust the C-arm positioning.<br />
                    <strong>Arrows:</strong> Move the machine along the floor.<br />
                    <strong>Lift:</strong> Adjust height.<br />
                    <strong>WigWag:</strong> Angle the detector horizontally.<br />
                    <strong>Orbital:</strong> Angle the detector vertically.<br />
                    <strong>Column Rot:</strong> Rotate the main column.<br />
                    <strong>Expose:</strong> Capture an X-ray image.
                </>
            )
        },
        {
            title: "Taking X-Rays",
            image: realXrayExposeImg,
            content: "Once the patient is in the beam path, click the orange EXPOSE button on the control panel to capture an image. The live fluoroscopy view will update with the simulated X-ray."
        },
        {
            title: "Keyboard Shortcuts",
            image: keyboardLegendImg,
            content: "Press I to toggle this Instructions canvas\n\nPress P to toggle Patient visibility\n\nPress L to toggle skeleton landmarks\n\nPress D to toggle the Debug view & floor labels\n\nPress C to connect/disconnect the External Hardware Serial"
        },
        {
            title: "Hardware Connection",
            images: [prototypeImg, usbPlugImg],
            content: "To control the simulation using the physical C-arm prototype, connect the Arduino to your computer via a USB cable (this is a must).\n\nOnce connected via USB, press the C button on your keyboard to establish the connection."
        },
        {
            title: "Debugging & Calibration",
            images: [debugModeImg, debugOverlayImg],
            content: "Press D to toggle Debug Mode. This helps with calibration by showing real-time spatial positioning, XYZ coordinate lines, and floor boundaries.\n\nUse the CAM and RS buttons on the debug overlay (bottom-left) to manually adjust the Camera and RealSense depth sensor offsets and rotations."
        }
    ];

    const current = pages[page];

    // Neumorphic unified styles - Dark Theme
    const bgDark = '#1e2832';
    const textPrimary = '#e2e8f0';
    const textSecondary = '#a0aec0';

    // Subtle shadows for dark theme
    const shadowOuter = '8px 8px 16px rgba(0, 0, 0, 0.4), -8px -8px 16px rgba(255, 255, 255, 0.03)';
    const shadowInner = 'inset 4px 4px 8px rgba(0, 0, 0, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.03)';
    const shadowActive = 'inset 2px 2px 4px rgba(0, 0, 0, 0.5), inset -2px -2px 4px rgba(255, 255, 255, 0.02)';

    const btnStyle = {
        padding: '12px 24px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.02)', // slight border helps pop in dark mode
        background: bgDark,
        color: textPrimary,
        fontWeight: 'bold',
        fontSize: '15px',
        cursor: 'pointer',
        boxShadow: shadowOuter,
        transition: 'all 0.2s ease-in-out',
        outline: 'none'
    };

    const btnDisabledStyle = {
        ...btnStyle,
        color: '#4a5568',
        boxShadow: shadowInner,
        cursor: 'not-allowed',
        border: 'none',
    };

    const btnPrimaryStyle = {
        ...btnStyle,
        color: '#4a90e2',
    };

    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)'
        }}>
            <div style={{
                backgroundColor: bgDark,
                borderRadius: '24px',
                padding: '40px',
                width: '850px', // Wider fixed size
                maxWidth: '95vw',
                height: '500px', // Fixed height
                color: textPrimary,
                fontFamily: 'sans-serif',
                boxShadow: shadowOuter,
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                opacity: 0.9
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '26px', fontWeight: '800', color: '#4a90e2', textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>
                        {current.title}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: bgDark,
                            border: '1px solid rgba(255, 255, 255, 0.02)',
                            color: textSecondary,
                            cursor: 'pointer',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            boxShadow: shadowOuter,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                        }}
                        onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                        onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                    >
                        ✕
                    </button>
                </div>

                {/* Main Content Area - Side by Side Flex */}
                <div style={{ display: 'flex', flex: 1, gap: '24px', minHeight: '0' }}>

                    {/* Left: Text Content */}
                    <div style={{
                        flex: '1',
                        fontSize: '17px',
                        lineHeight: '1.8',
                        whiteSpace: 'pre-line',
                        color: '#e2e8f0',
                        padding: '24px',
                        borderRadius: '16px',
                        backgroundColor: bgDark,
                        border: '1px solid rgba(255, 255, 255, 0.02)',
                        boxShadow: shadowInner,
                        fontWeight: '500',
                        overflowY: 'auto'
                    }}>
                        {current.content}
                    </div>

                    {/* Right: Image Content (if exists) */}
                    {(current.image || current.images) && (
                        <div style={{
                            flex: '1.2', // Image gets slightly more space
                            borderRadius: '16px',
                            overflow: 'hidden',
                            backgroundColor: bgDark,
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            boxShadow: shadowInner,
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '16px',
                            gap: '12px'
                        }}>
                            {current.image && (
                                <img
                                    src={current.image}
                                    alt={current.title}
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        objectFit: 'contain',
                                        borderRadius: '8px'
                                    }}
                                />
                            )}
                            {current.images && current.images.map((img, idx) => (
                                <img
                                    key={idx}
                                    src={img}
                                    alt={`${current.title} ${idx + 1}`}
                                    style={{
                                        width: `${Math.floor(100 / current.images.length)}%`,
                                        height: '100%',
                                        objectFit: 'contain',
                                        borderRadius: '8px'
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                    {/* Pagination Dots */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {pages.map((_, i) => (
                            <div key={i} style={{
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                backgroundColor: bgDark,
                                boxShadow: i === page ? shadowInner : shadowOuter,
                                border: i === page ? '2px solid #4a90e2' : '1px solid rgba(255,255,255,0.02)'
                            }} />
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '16px' }}>
                        <button
                            disabled={page === 0}
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            style={page === 0 ? btnDisabledStyle : btnStyle}
                            onMouseDown={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowActive; }}
                            onMouseUp={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowOuter; }}
                            onMouseLeave={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowOuter; }}
                        >
                            Back
                        </button>

                        {page < pages.length - 1 ? (
                            <button
                                onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
                                style={btnPrimaryStyle}
                                onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                                onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                                onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                onClick={onClose}
                                style={{ ...btnStyle, color: '#38a169' }}
                                onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                                onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                                onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                            >
                                Finish
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div >
    );
};

export default Instructions;
