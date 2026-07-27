import React, { useRef, useEffect } from 'react';
import { CONTROL_SPECS } from '../constants';

const ControllerPanel = ({ setControls, onExpose, beamActive }) => {
    const intervalRef = useRef(null);

    // --- CONFIGURATION ---
    // Mapping internal keys to the Visual Design
    // D-PAD: Up/Down -> cart_x (Longitudinal), Left/Right -> cart_z (Lateral)
    // ORBITAL: Purple (C-Arm Rotation)
    // WIG-WAG: Yellow/Blue (Angulation)
    // LIFT: Orange (Height)
    // COL ROT: Grey (Column Rotation)

    const stopMove = () => {
        if (intervalRef.current) {
            cancelAnimationFrame(intervalRef.current);
            intervalRef.current = null;
        }
    };

    const startMove = (key, dir) => {
        if (beamActive) return; // Lock when exposing
        stopMove(); // Safety clear

        let lastT = performance.now();

        // Derive speed directly from CONTROL_SPECS step for consistency
        const speedPerSec = CONTROL_SPECS[key].step * 60 * dir;

        const tick = (t) => {
            const dt = Math.min(0.05, (t - lastT) / 1000); // seconds, clamp huge jumps
            lastT = t;

            setControls(prev => {
                const next = { ...prev };
                next[key] += speedPerSec * dt;  // consistent across FPS

                // Note: Limits are robustly clamped in App.jsx via CONTROL_SPECS
                return next;
            });

            intervalRef.current = requestAnimationFrame(tick);
        };
        intervalRef.current = requestAnimationFrame(tick);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => stopMove();
    }, []);


    // --- STYLES ---
    const styles = {
        panel: {
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            width: '280px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '20px', // Siemens rounded corners
            padding: '20px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            userSelect: 'none',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.5)',
            transform: 'scale(0.7)',
            transformOrigin: 'bottom right'
        },
        header: {
            color: '#ff6600',
            fontSize: '10px',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
            marginBottom: '10px',
            textTransform: 'uppercase'
        },
        exposeBtn: {
            width: '140px',
            height: '45px',
            borderRadius: '25px',
            background: 'linear-gradient(135deg, #ffcc00 0%, #ff9900 100%)',
            border: 'none',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '14px',
            letterSpacing: '1px',
            boxShadow: '0 4px 15px rgba(255, 165, 0, 0.4)',
            cursor: beamActive ? 'not-allowed' : 'pointer',
            marginBottom: '10px',
            opacity: beamActive ? 0.7 : 1,
            transition: 'transform 0.1s',
            outline: 'none'
        },

        dPad: {
            position: 'relative',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            backgroundColor: '#f8f9fa',
            boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05), 0 5px 15px rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '30px'
        },
        dPadBtn: {
            position: 'absolute',
            width: '30px',
            height: '30px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s',
        },
        dPadCenter: {
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            border: '2px solid #e0e0e0',
            backgroundColor: 'white'
        },
        row: {
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            marginBottom: '20px'
        },
        col: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            flex: 1
        },
        label: {
            fontSize: '9px',
            color: '#999',
            fontWeight: 'bold',
            marginBottom: '5px',
            textTransform: 'uppercase'
        },
        roundBtn: {
            width: '45px',
            height: '45px',
            borderRadius: '50%',
            border: '1.5px solid',
            backgroundColor: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.1s active',
            fontSize: '18px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.02)'
        },
        // Color Themes
        themePurple: { borderColor: '#9b59b6', color: '#9b59b6' }, // Orbital
        themeYellow: { borderColor: '#f1c40f', color: '#f1c40f' }, // WigWag +
        themeBlue: { borderColor: '#3498db', color: '#3498db' }, // WigWag -
        themeOrange: { borderColor: '#e67e22', color: '#e67e22' }, // Lift
        themeGrey: { borderColor: '#7f8c8d', color: '#7f8c8d' }, // Col Rot

        presets: {
            display: 'flex',
            justifyContent: 'space-around',
            width: '100%',
            marginTop: '10px',
            borderTop: '1px solid #eee',
            paddingTop: '15px'
        },
        presetBtn: {
            background: 'none',
            border: 'none',
            color: '#ccc',
            fontWeight: 'bold',
            fontSize: '14px',
            cursor: 'not-allowed' // Placeholder
        }
    };

    // Helper for button events (SIM ONLY)
    // No Arduino connection attempts from movement buttons.
    const bindBtn = (key, dir) => ({
        onMouseDown: () => startMove(key, dir),
        onMouseUp: stopMove,
        onMouseLeave: stopMove,
        onTouchStart: (e) => { e.preventDefault(); startMove(key, dir); },
        onTouchEnd: stopMove,
        onTouchCancel: stopMove
    });


    return (
        <div style={styles.panel}>
            <div style={styles.header}>Siemens Healthineers</div>

            <button
                style={styles.exposeBtn}
                onClick={onExpose}
                disabled={beamActive}
            >
                {beamActive ? 'EXPOSING' : 'EXPOSE'}
            </button>

            {/* D-Pad (Cart Movement) */}
            <div style={styles.dPad}>
                <button style={{ ...styles.dPadBtn, top: '5px' }} {...bindBtn('cart_x', -1)}>⬆</button>
                <button style={{ ...styles.dPadBtn, bottom: '5px' }} {...bindBtn('cart_x', 1)}>⬇</button>
                <button style={{ ...styles.dPadBtn, left: '5px' }} {...bindBtn('cart_z', 1)}>⬅</button>
                <button style={{ ...styles.dPadBtn, right: '5px' }} {...bindBtn('cart_z', -1)}>➡</button>
                <div style={styles.dPadCenter}></div>
            </div>

            <div style={styles.row}>
                {/* Orbital (Purple) */}
                <div style={styles.col}>
                    <span style={styles.label}>Orbital</span>
                    <button style={{ ...styles.roundBtn, ...styles.themePurple }} {...bindBtn('orbital_slide', -1)}>↻</button>
                    <button style={{ ...styles.roundBtn, ...styles.themePurple }} {...bindBtn('orbital_slide', 1)}>↺</button>
                </div>

                {/* Wig-Wag (Yellow/Blue) */}
                <div style={styles.col}>
                    <span style={styles.label}>Wig-Wag</span>
                    <button style={{ ...styles.roundBtn, ...styles.themeYellow }} {...bindBtn('wig_wag', 1)}>Y+</button>
                    <button style={{ ...styles.roundBtn, ...styles.themeBlue }}   {...bindBtn('wig_wag', -1)}>Y-</button>
                </div>

                {/* Lift (Orange) */}
                <div style={styles.col}>
                    <span style={styles.label}>Lift</span>
                    <button style={{ ...styles.roundBtn, ...styles.themeOrange }} {...bindBtn('lift', 1)}>⬆</button>
                    <button style={{ ...styles.roundBtn, ...styles.themeOrange }} {...bindBtn('lift', -1)}>⬇</button>
                </div>
            </div>

            {/* Column Rotation (Grey) */}
            <div style={{ ...styles.col, width: '100%', alignItems: 'center' }}>
                <span style={styles.label}>Col Rot</span>
                <div style={{ display: 'flex', gap: '15px' }}>
                    <button style={{ ...styles.roundBtn, ...styles.themeGrey }} {...bindBtn('column_rot', -1)}>↺</button>
                    <button style={{ ...styles.roundBtn, ...styles.themeGrey }} {...bindBtn('column_rot', 1)}>↻</button>
                </div>
            </div>

            {/* Presets Footer */}
            <div style={styles.presets}>
                <button style={styles.presetBtn}>1</button>
                <button style={styles.presetBtn}>2</button>
                <button style={styles.presetBtn}>P</button>
            </div>
        </div>
    );
};

export default ControllerPanel;
