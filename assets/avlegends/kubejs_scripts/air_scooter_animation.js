PalladiumEvents.registerAnimations((event) => {
    const molang = Java.loadClass('software.bernie.geckolib.core.molang.MolangParser').INSTANCE;
    const rollQuery = molang.getVariable('query.avlegends_scooter_roll');
    const yawQuery = molang.getVariable('query.avlegends_scooter_yaw');
    const scooterStates = {};
    const shellParticleCount = 56;
    let cloudOptions = null;

    rollQuery.set(0.0);
    yawQuery.set(0.0);

    // Minecraft members can have mapped or production (SRG) names in Rhino.
    function particleCall(target, mapped, production, args) {
        if (!target) return null;
        let method = target[mapped];
        if (typeof method !== 'function') method = target[production];
        return typeof method === 'function' ? method.apply(target, args) : null;
    }

    function coordinate(vector, mapped, production, getter) {
        if (!vector) return NaN;
        // Vec3 exposes both x/y/z fields and x()/y()/z() methods. Rhino's
        // FieldAndMethods wrapper crashes if Number() tries to coerce it.
        // Use primitive SRG fields or invoke the coordinate getter instead.
        let value = vector[production];
        if (typeof value === 'number') return value;
        value = particleCall(vector, mapped, getter, []);
        if (typeof value === 'number') return value;
        value = vector[mapped];
        return typeof value === 'number' ? value : NaN;
    }

    function clearClouds(state) {
        if (!state) return;
        for (let i = 0; i < state.motes.length; i++) {
            particleCall(state.motes[i].particle, 'remove', 'm_107274_', []);
        }
    }

    function tintCloud(cloud, shade) {
        // Match the scooter's icy blue/white texture while keeping cloud sprites.
        const light = Math.max(0.0, Math.min(1.0, shade));
        particleCall(cloud, 'setColor', 'm_107253_', [
            0.64 + light * 0.18,
            0.84 + light * 0.12,
            1.0
        ]);
    }

    function groundClouds(engine, state, x, y, z, motionX, motionZ, speed, now, grounded) {
        if (!grounded) {
            state.groundAnchor = null;
            state.lastGroundTime = now - 100;
            return;
        }

        const moving = speed > 0.002;
        const interval = moving ? 50 : 100;
        if (now - state.lastGroundTime < interval) return;
        state.lastGroundTime = now;
        const count = moving ? 4 : 3;
        const directionX = moving ? motionX / speed : 0.0;
        const directionZ = moving ? motionZ / speed : 0.0;
        let anchor = state.groundAnchor;
        // Do not connect a trail across teleports or time spent in the air.
        if (!anchor || Math.abs(x - anchor.x) + Math.abs(z - anchor.z) > 2.0) {
            anchor = {x: x, y: y, z: z};
        }

        for (let i = 0; i < count; i++) {
            let phase = state.groundBurst * 2.399963229728653 + i * 6.283185307179586 / count;
            let distance = i === 0 ? 0.0 : 0.12 + (i % 3) * 0.07;
            let spreadX = Math.cos(phase) * distance;
            let spreadZ = Math.sin(phase) * distance;
            let t = (i + 1.0) / count;
            let px = anchor.x + (x - anchor.x) * t + spreadX - directionX * 0.12;
            let py = anchor.y + (y - anchor.y) * t + 0.04;
            let pz = anchor.z + (z - anchor.z) * t + spreadZ - directionZ * 0.12;
            let cloud = particleCall(engine, 'createParticle', 'm_107370_', [cloudOptions, px, py, pz, 0.0, 0.0, 0.0]);
            tintCloud(cloud, 0.45 + Math.random() * 0.55);
            particleCall(cloud, 'scale', 'm_6569_', [0.45 + Math.random() * 0.65]);
            particleCall(cloud, 'setLifetime', 'm_107257_', [(moving ? 26 : 20) + Math.floor(Math.random() * 11)]);
            particleCall(cloud, 'setParticleSpeed', 'm_172260_', [
                spreadX * 0.045 - directionX * 0.008,
                0.002,
                spreadZ * 0.045 - directionZ * 0.008
            ]);
            // Ground puffs are intentionally not attached to the scooter:
            // they linger at the contact point and form the trail behind it.
        }
        state.groundBurst++;
        state.groundAnchor = {x: x, y: y, z: z};
    }

    function updateScooter(player, partialTicks, playerKey, progress) {
        const now = Date.now();
        // Support both mapped names and the public Forge 1.20.1 SRG fields.
        let bodyYaw = Number(player.yBodyRot);
        let previousBodyYaw = Number(player.yBodyRotO);
        if (!isFinite(bodyYaw)) bodyYaw = Number(player.f_20883_);
        if (!isFinite(previousBodyYaw)) previousBodyYaw = Number(player.f_20884_);
        if (!isFinite(bodyYaw)) bodyYaw = 0.0;
        if (!isFinite(previousBodyYaw)) previousBodyYaw = bodyYaw;
        const yawDelta = ((bodyYaw - previousBodyYaw + 540.0) % 360.0) - 180.0;
        bodyYaw = previousBodyYaw + yawDelta * partialTicks;

        let state = scooterStates[playerKey];
        if (!state) {
            state = {
                lastTime: now, heading: bodyYaw, roll: 0.0, motes: [],
                lastGroundTime: now - 100, groundBurst: 0, groundAnchor: null,
                idleFlow: 0.0, idleBlend: 0.0
            };
            for (let i = 0; i < shellParticleCount; i++) {
                let theta = (i + 0.5) * 3.141592653589793 / shellParticleCount;
                let phi = i * 2.399963229728653;
                state.motes.push({
                    x: 11.2 * Math.sin(theta) * Math.cos(phi),
                    y: 11.2 * Math.cos(theta),
                    z: 11.2 * Math.sin(theta) * Math.sin(phi),
                    sizePhase: Math.random() * 6.283185307179586,
                    colorShade: Math.random(),
                    idleDepth: (Math.random() - 0.5) * 3.2,
                    idleJitter: (Math.random() - 0.5) * 0.8
                });
            }
            scooterStates[playerKey] = state;
        }

        // Rendering may call this several times per frame. Integrate only the
        // elapsed time, and discard menu/reload gaps instead of jumping ahead.
        const elapsed = Math.max(0.0, Math.min((now - state.lastTime) / 1000.0, 0.1));
        state.lastTime = now;
        const rawX = Number(player.getMotionX());
        const rawZ = Number(player.getMotionZ());
        const motionX = isFinite(rawX) ? rawX : 0.0;
        const motionZ = isFinite(rawZ) ? rawZ : 0.0;
        const speed = Math.sqrt(motionX * motionX + motionZ * motionZ);

        if (speed > 0.002) {
            // Minecraft yaw: zero is south (+Z), positive turns toward west.
            state.heading = Math.atan2(-motionX, motionZ) * 57.29577951308232;
            // A radius of 10 model pixels is 0.625 blocks. Roll by distance/radius.
            state.roll = (state.roll + speed * 20.0 * elapsed * 91.67324722093171) % 360.0;
        } else {
            // At rest, freeze the rolling axis and turn only around vertical Y.
            state.heading = (state.heading + elapsed * 48.0) % 360.0;
        }

        // The outer bone steers; the inner bone rolls. Cancel the player's body
        // yaw so strafing and reversing follow velocity rather than camera aim.
        yawQuery.set(state.heading - bodyYaw);
        rollQuery.set(state.roll);

        // Use Minecraft's real cloud factory and keep its particle handles on
        // the spherical paths instead of leaving stationary clouds behind.
        const engine = Client.particleEngine || Client.f_91061_;
        if (!engine) return;
        if (!cloudOptions) cloudOptions = Utils.particleOptions('minecraft:cloud');
        const position = particleCall(player, 'getPosition', 'm_20318_', [partialTicks]);
        let playerX = coordinate(position, 'x', 'f_82479_', 'm_7096_');
        let playerY = coordinate(position, 'y', 'f_82480_', 'm_7098_');
        let playerZ = coordinate(position, 'z', 'f_82481_', 'm_7094_');
        if (!isFinite(playerX)) playerX = Number(particleCall(player, 'getX', 'm_20185_', []));
        if (!isFinite(playerY)) playerY = Number(particleCall(player, 'getY', 'm_20186_', []));
        if (!isFinite(playerZ)) playerZ = Number(particleCall(player, 'getZ', 'm_20189_', []));
        if (!isFinite(playerX) || !isFinite(playerY) || !isFinite(playerZ)) return;
        const poseProgress = Math.max(0.0, Math.min(1.0, Number(progress)));
        const eased = poseProgress < 0.5 ? 4.0 * poseProgress * poseProgress * poseProgress
            : 1.0 - Math.pow(-2.0 * poseProgress + 2.0, 3.0) / 2.0;
        const bob = Math.sin(((now % 7200) / 50.0) * 0.08726646259971647) * 0.35;
        const centerY = playerY + ((12.0 + bob) * eased - 2.0) / 16.0;
        const rolling = speed > 0.002;
        const angle = rolling ? speed * 20.0 * elapsed / 0.625 : 0.0;
        const turnCos = Math.cos(angle);
        const turnSin = Math.sin(angle);
        const axisX = rolling ? motionZ / speed : 0.0;
        const axisZ = rolling ? -motionX / speed : 0.0;
        if (rolling) {
            state.idleBlend = 0.0;
        } else {
            state.idleFlow = (state.idleFlow + elapsed * 0.65) % 1.0;
            state.idleBlend = Math.min(1.0, state.idleBlend + elapsed * 6.0);
        }

        for (let i = 0; i < state.motes.length; i++) {
            let mote = state.motes[i];
            let fade = 1.0;
            let offsetX = mote.x;
            let offsetY = mote.y;
            let offsetZ = mote.z;
            let shade = mote.colorShade;
            if (rolling) {
                // Rodrigues rotation around the same world-space rolling axis
                // as the sphere, retaining positions when direction changes.
                let dot = axisX * mote.x + axisZ * mote.z;
                let x = mote.x * turnCos - axisZ * mote.y * turnSin + axisX * dot * (1.0 - turnCos);
                let y = mote.y * turnCos + (axisZ * mote.x - axisX * mote.z) * turnSin;
                let z = mote.z * turnCos + axisX * mote.y * turnSin + axisZ * dot * (1.0 - turnCos);
                mote.x = x;
                mote.y = y;
                mote.z = z;
                offsetX = x;
                offsetY = y;
                offsetZ = z;
            } else {
                // Spread the downward streams around the entire lower sphere,
                // forming a continuous 360-degree curtain instead of two sides.
                let travel = (state.idleFlow + i / shellParticleCount) % 1.0;
                let remaining = 1.0 - travel;
                let arcRadius = 1.45 * remaining * remaining + 2.08 * remaining * travel + 0.62 * travel * travel;
                let arcY = 0.32 * remaining * remaining - 0.50 * remaining * travel - 0.82 * travel * travel;
                let azimuth = i * 2.399963229728653 + mote.idleDepth * 0.08 + state.idleFlow * 0.35;
                let radius = arcRadius * 10.5 + mote.idleJitter;
                let targetX = Math.cos(azimuth) * radius;
                let targetY = arcY * 10.5 + mote.idleJitter * 0.35;
                let targetZ = Math.sin(azimuth) * radius;
                offsetX += (targetX - offsetX) * state.idleBlend;
                offsetY += (targetY - offsetY) * state.idleBlend;
                offsetZ += (targetZ - offsetZ) * state.idleBlend;
                let streamFade = Math.min(1.0, travel * 8.0, remaining * 8.0);
                fade = 1.0 + (streamFade - 1.0) * state.idleBlend;
                shade = 0.20 + travel * 0.80;
            }

            let x = playerX + offsetX / 16.0;
            let y = centerY + offsetY / 16.0;
            let z = playerZ + offsetZ / 16.0;
            if (!mote.particle || particleCall(mote.particle, 'isAlive', 'm_107276_', []) !== true) {
                mote.particle = particleCall(engine, 'createParticle', 'm_107370_', [cloudOptions, x, y, z, 0.0, 0.0, 0.0]);
                mote.lastScale = 1.0;
                mote.baseScale = 0.30 + Math.random() * 0.60;
                // A finite lifetime also cleans up clouds if the player stops
                // rendering, disconnects, or reloads the client scripts.
                particleCall(mote.particle, 'setLifetime', 'm_107257_', [60]);
            }
            // Give each vanilla cloud its own size, plus a subtle size pulse.
            // Apply the ratio so repeated render calls do not compound scaling.
            let sizePulse = 0.95 + Math.sin((now % 6000) * 0.001047197551196598 + mote.sizePhase) * 0.05;
            let scale = Math.max(0.02, fade) * mote.baseScale * sizePulse;
            particleCall(mote.particle, 'scale', 'm_6569_', [scale / mote.lastScale]);
            tintCloud(mote.particle, shade);
            mote.lastScale = scale;
            particleCall(mote.particle, 'setParticleSpeed', 'm_172260_', [0.0, 0.0, 0.0]);
            particleCall(mote.particle, 'setPos', 'm_107264_', [x, y, z]);
        }

        const grounded = particleCall(player, 'onGround', 'm_20096_', []) === true;
        groundClouds(engine, state, playerX, playerY, playerZ, motionX, motionZ, speed, now, grounded && poseProgress > 0.95);
    }

    event.registerForPower('avlegends/air_scooter_pose', 'avlegends:airbending', 100, (builder) => {
        const player = builder.getPlayer();
        const partialTicks = builder.getPartialTicks();
        const progress = animationUtil.getAnimationTimerAbilityValue(
            player,
            'avlegends:airbending',
            'air_scooter_animation',
            partialTicks
        );

        const playerKey = String(player.getProfile().getId());
        if (progress <= 0.0) {
            clearClouds(scooterStates[playerKey]);
            delete scooterStates[playerKey];
            return;
        }

        updateScooter(player, partialTicks, playerKey, progress);

        if (builder.isFirstPerson()) {
            return;
        }

        // Use Rhino's JavaScript clock. Minecraft's getGameTime/tickCount
        // names are not available to this client script in production.
        const time = (Date.now() % 7200) / 50.0;
        const breathe = Math.sin(time * 0.08726646259971647);

        // Lift the entire render, including the independent scooter layer.
        // Keep the player on its vertical centerline throughout the loop.
        builder.get('body')
            .setX(0.0)
            .setY(12.0 + breathe * 0.35)
            .setZ(0.0)
            .animate('InOutCubic', progress);

        builder.get('chest')
            .setXRotDegrees(0.0)
            .setYRotDegrees(0.0)
            .setZRotDegrees(0.0)
            .animate('InOutCubic', progress);

        builder.get('head')
            .setXRotDegrees(4.0 + breathe * 1.0)
            .animate('InOutCubic', progress);

        builder.get('right_arm')
            .setXRotDegrees(-55.0)
            .setYRotDegrees(0.0)
            .setZRotDegrees(-45.0)
            .animate('InOutCubic', progress);

        builder.get('left_arm')
            .setXRotDegrees(-55.0)
            .setYRotDegrees(0.0)
            .setZRotDegrees(45.0)
            .animate('InOutCubic', progress);

        builder.get('right_leg')
            .setXRotDegrees(-65.0)
            .setYRotDegrees(0.0)
            .setZRotDegrees(-65.0)
            .animate('InOutCubic', progress);

        builder.get('left_leg')
            .setXRotDegrees(-65.0)
            .setYRotDegrees(0.0)
            .setZRotDegrees(65.0)
            .animate('InOutCubic', progress);
    });
});
