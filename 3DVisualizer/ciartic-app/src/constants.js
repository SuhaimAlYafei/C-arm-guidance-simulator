import * as THREE from 'three';

const D2R = Math.PI / 180;

export const DEVICE_PROFILE = {
    limits: {
        // Translations (meters)
        lift: { min: -0.5, max: 0.05 },
        cart_x: { min: 1.4, max: 2.5 },
        cart_z: { min: -0.7, max: 0.8 },
        // Rotations (degrees) - will be converted to radians for control limits
        orbital: { min: -100, max: 100 },
        wig_wag: { min: -23, max: 23 },    // approx +/- 0.4 rad
        column_rot: { min: -86, max: 86 }, // approx +/- 1.5 rad
    }
};

export const CONTROL_SPECS = {
    cart_x: {
        label: 'Cart Long',
        type: 'translate',
        ...DEVICE_PROFILE.limits.cart_x,
        step: 0.02
    },
    cart_z: {
        label: 'Cart Lat',
        type: 'translate',
        ...DEVICE_PROFILE.limits.cart_z,
        step: 0.02
    },
    lift: {
        label: 'Lift',
        type: 'translate',
        ...DEVICE_PROFILE.limits.lift,
        step: 0.002
    },
    orbital_slide: {
        label: 'Orbital',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.orbital.min * D2R,
        max: DEVICE_PROFILE.limits.orbital.max * D2R,
        step: 0.2 * D2R
    },
    wig_wag: {
        label: 'Wig Wag',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.wig_wag.min * D2R,
        max: DEVICE_PROFILE.limits.wig_wag.max * D2R,
        step: 0.2 * D2R
    },
    column_rot: {
        label: 'Column Rot',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.column_rot.min * D2R,
        max: DEVICE_PROFILE.limits.column_rot.max * D2R,
        step: 1.0 * D2R
    },
};
