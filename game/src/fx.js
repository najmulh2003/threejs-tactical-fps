// Transient combat effects, all pooled and reused so the hot loop makes no
// new objects: tracers (thin lines from muzzle to hit), impact sparks (a
// points cloud with per-point velocity), and explosions (an expanding shell
// plus a light). Nothing here allocates per frame.
import * as THREE from 'three';

const TRACER_COUNT = 16;
const TRACER_LIFE = 0.07;
const SPARK_COUNT = 240;
const FLASH_COUNT = 8;

export function createFx(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkVelocities = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMaterial = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0;

  const flashes = [];
  for (let i = 0; i < FLASH_COUNT; i += 1) {
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    sprite.visible = false;
    scene.add(sprite);
    flashes.push({ sprite, life: 0 });
  }

  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(0xff8c2e, 0, 26);
  scene.add(blastLight);
  let blastLife = 0;

  const tmp = new THREE.Vector3();

  return {
    tracer(from, to) {
      const slot = tracers.find((t) => t.life <= 0) ?? tracers[0];
      const positions = slot.line.geometry.attributes.position.array;
      positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
      positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.material.opacity = 0.9;
      slot.life = TRACER_LIFE;
    },
    impact(point, normal, count = 6) {
      for (let n = 0; n < count; n += 1) {
        const i = sparkCursor;
        sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
        sparkPositions[i * 3] = point.x;
        sparkPositions[i * 3 + 1] = point.y;
        sparkPositions[i * 3 + 2] = point.z;
        tmp.set(Math.random() * 2 - 1, Math.random() * 1.4, Math.random() * 2 - 1).add(normal).normalize().multiplyScalar(2 + Math.random() * 3);
        sparkVelocities[i * 3] = tmp.x;
        sparkVelocities[i * 3 + 1] = tmp.y;
        sparkVelocities[i * 3 + 2] = tmp.z;
        sparkLife[i] = 0.25 + Math.random() * 0.2;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
    },
    flashAt(point, camera) {
      const slot = flashes.find((f) => f.life <= 0) ?? flashes[0];
      slot.sprite.position.copy(point);
      slot.sprite.lookAt(camera.position);
      slot.sprite.visible = true;
      slot.sprite.material.opacity = 0.95;
      slot.life = 0.06;
    },
    explosion(point) {
      blast.position.copy(point);
      blast.visible = true;
      blastLife = 0.6;
      blastLight.position.copy(point);
      blastLight.intensity = 60;
    },
    step(dt) {
      for (const tracer of tracers) {
        if (tracer.life > 0) {
          tracer.life -= dt;
          tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.9;
        }
      }
      let anySpark = false;
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        if (sparkLife[i] <= 0) continue;
        anySpark = true;
        sparkLife[i] -= dt;
        sparkPositions[i * 3] += sparkVelocities[i * 3] * dt;
        sparkPositions[i * 3 + 1] += sparkVelocities[i * 3 + 1] * dt;
        sparkPositions[i * 3 + 2] += sparkVelocities[i * 3 + 2] * dt;
        sparkVelocities[i * 3 + 1] -= 9 * dt;
        if (sparkPositions[i * 3 + 1] < 0.02) {
          sparkPositions[i * 3 + 1] = 0.02;
          sparkVelocities[i * 3 + 1] *= -0.4;
        }
      }
      if (anySpark) sparkGeometry.attributes.position.needsUpdate = true;
      for (const flash of flashes) {
        if (flash.life > 0) {
          flash.life -= dt;
          flash.sprite.material.opacity = Math.max(0, flash.life / 0.06) * 0.95;
          if (flash.life <= 0) flash.sprite.visible = false;
        }
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const t = 1 - blastLife / 0.6;
        const radius = 0.5 + t * 7;
        blast.scale.setScalar(radius);
        blast.material.opacity = Math.max(0, 0.75 * (1 - t));
        blastLight.intensity = Math.max(0, 60 * (1 - t));
        if (blastLife <= 0) {
          blast.visible = false;
          blastLight.intensity = 0;
        }
      }
    },
  };
}
