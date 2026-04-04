(function () {
  const Potree = window.Potree;
  const THREE = window.THREE;

  if (!Potree || !Potree.VRControls || !Potree.TextSprite || !THREE) {
    console.warn('[VR external] Potree or THREE not available.');
    return;
  }

  const PointSizeType = Potree.PointSizeType;
  const BaseProto = Potree.VRControls.prototype;
  const fakeCam = new THREE.PerspectiveCamera();

  function ensureExternalState(vr) {
    if (vr.__externalVRReady) return;
    vr.__externalVRReady = true;

    vr.menu = vr.menu || null;
    vr.menuButtons = vr.menuButtons || [];
    vr.menuVisible = typeof vr.menuVisible === 'boolean' ? vr.menuVisible : false;
    vr.menuHovered = vr.menuHovered || null;
    vr.menuPressLock = typeof vr.menuPressLock === 'boolean' ? vr.menuPressLock : false;
    vr.menuController = vr.menuController || null;
    vr.tmpVec = vr.tmpVec || new THREE.Vector3();
    vr.tmpVec2 = vr.tmpVec2 || new THREE.Vector3();
    vr.tmpRaycaster = vr.tmpRaycaster || new THREE.Raycaster();
  }

  function getThumbstickAxes(controller) {
    if (!controller || !controller.inputSource || !controller.inputSource.gamepad) {
      return null;
    }

    const axes = controller.inputSource.gamepad.axes || [];
    let x = 0;
    let y = 0;

    if (axes.length >= 4) {
      x = axes[2];
      y = axes[3];
    } else if (axes.length >= 2) {
      x = axes[0];
      y = axes[1];
    } else {
      return null;
    }

    const DEADZONE = 0.15;
    if (Math.abs(x) < DEADZONE) x = 0;
    if (Math.abs(y) < DEADZONE) y = 0;

    return { x, y };
  }

  function getSceneMoveFactors(vr) {
    let maxSize = 1;
    for (const pc of vr.viewer.scene.pointclouds) {
      if (!pc.boundingBox) continue;
      const size = pc.boundingBox.min.distanceTo(pc.boundingBox.max);
      maxSize = Math.max(maxSize, size);
    }

    return {
      multiplicator: Math.pow(maxSize, 0.5) / 2,
      scale: vr.node.scale.x,
      moveSpeed: vr.viewer.getMoveSpeed(),
    };
  }

  function getHorizontalViewAxes(vr) {
    const camVR = vr.viewer.renderer.xr.getCamera(fakeCam);
    const vrPos = camVR.getWorldPosition(new THREE.Vector3());
    const vrDir = camVR.getWorldDirection(new THREE.Vector3());

    const scenePos = vr.toScene(vrPos);
    const sceneLook = vr.toScene(vrPos.clone().add(vrDir));

    const forward = sceneLook.sub(scenePos);
    forward.z = 0;
    if (forward.lengthSq() === 0) {
      forward.set(0, 1, 0);
    }
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();
    return { forward, right };
  }

  function computeLeftStickMove(vr) {
    const stick = getThumbstickAxes(vr.cPrimary);
    if (!stick) return new THREE.Vector3();

    const y = Math.sign(stick.y) * Math.pow(Math.abs(stick.y), 2);
    const factors = getSceneMoveFactors(vr);
    const verticalBoost = 1.8;

    const amountVertical = verticalBoost
      * factors.multiplicator
      * y
      * Math.pow(factors.moveSpeed, 0.5)
      / factors.scale;

    return new THREE.Vector3(0, 0, amountVertical);
  }

  function computeLeftStickTurn(vr) {
    const stick = getThumbstickAxes(vr.cPrimary);
    if (!stick) return 0;

    const TURN_DEADZONE = 0.15;
    const TURN_SPEED = 1.8;
    const x = stick.x;

    if (Math.abs(x) < TURN_DEADZONE) return 0;
    return Math.sign(x) * Math.pow(Math.abs(x), 2) * TURN_SPEED;
  }

  function computeRightStickMove(vr) {
    const stick = getThumbstickAxes(vr.cSecondary);
    if (!stick) return new THREE.Vector3();

    const x = Math.sign(stick.x) * Math.pow(Math.abs(stick.x), 2);
    const y = Math.sign(stick.y) * Math.pow(Math.abs(stick.y), 2);
    const factors = getSceneMoveFactors(vr);
    const axes = getHorizontalViewAxes(vr);
    const rightStickSpeedBoost = 5;

    const amountForward = rightStickSpeedBoost
      * factors.multiplicator
      * y
      * Math.pow(factors.moveSpeed, 0.5)
      / factors.scale;

    const amountStrafe = rightStickSpeedBoost
      * factors.multiplicator
      * x
      * Math.pow(factors.moveSpeed, 0.5)
      / factors.scale;

    const move = new THREE.Vector3();
    move.add(axes.forward.clone().multiplyScalar(amountForward));
    move.add(axes.right.clone().multiplyScalar(amountStrafe));
    return move;
  }

  function applyExternalFly(vr, delta) {
    const moveLeft = computeLeftStickMove(vr);
    const moveRight = computeRightStickMove(vr);
    const move = moveLeft.clone().add(moveRight);

    move.multiplyScalar(-delta);
    vr.node.position.add(move);

    const smoothTurn = computeLeftStickTurn(vr);
    if (smoothTurn !== 0) {
      vr.node.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -smoothTurn * delta);
      vr.node.updateMatrix();
      vr.node.updateMatrixWorld();
    }

    const scale = vr.node.scale.x;
    const camVR = vr.viewer.renderer.xr.getCamera(fakeCam);
    const vrPos = camVR.getWorldPosition(new THREE.Vector3());
    const vrDir = camVR.getWorldDirection(new THREE.Vector3());

    const scenePos = vr.toScene(vrPos);
    const sceneDir = vr.toScene(vrPos.clone().add(vrDir)).sub(scenePos);
    sceneDir.normalize().multiplyScalar(scale);
    const sceneTarget = scenePos.clone().add(sceneDir);

    vr.viewer.scene.view.setView(scenePos, sceneTarget);
  }

  BaseProto.configureMenuTextSprite = function (sprite, options = {}) {
    const {
      fontface = 'Arial',
      fontsize = 32,
      scale = 0.042,
    } = options;

    sprite.fontface = fontface;
    sprite.fontsize = fontsize;
    sprite.borderThickness = 0;
    sprite.backgroundColor = { r: 0, g: 0, b: 0, a: 0.0 };
    sprite.borderColor = { r: 0, g: 0, b: 0, a: 0.0 };
    sprite.textColor = { r: 255, g: 255, b: 255, a: 1.0 };

    sprite.update();
    sprite.position.set(0, 0, 0.004);
    sprite.scale.set(scale, scale, 1);

    if (sprite.material) {
      sprite.material.transparent = true;
      sprite.material.depthTest = false;
      sprite.material.depthWrite = false;
    }

    if (sprite.material && sprite.material.map) {
      sprite.material.map.generateMipmaps = false;
      sprite.material.map.minFilter = THREE.LinearFilter;
      sprite.material.map.magFilter = THREE.LinearFilter;
      sprite.material.map.needsUpdate = true;
    }

    return sprite;
  };

  BaseProto.createMenuButton = function (label, x, y, width, height, onClick) {
    ensureExternalState(this);

    const group = new THREE.Object3D();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: 0x223344,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );

    const displayLabel = label === '-' ? '−' : label;
    const text = new Potree.TextSprite(displayLabel);

    if (label === '+' || label === '-') {
      this.configureMenuTextSprite(text, {
        fontface: 'Arial',
        fontsize: 42,
        scale: 0.048,
      });
    } else {
      this.configureMenuTextSprite(text, {
        fontface: 'Arial',
        fontsize: 34,
        scale: 0.040,
      });
    }

    group.add(bg);
    group.add(text);
    group.position.set(x, y, 0);
    group.userData.bg = bg;
    group.userData.text = text;
    group.userData.label = label;
    group.userData.onClick = onClick;

    this.menuButtons.push(group);
    return group;
  };

  BaseProto.setButtonLabel = function (button, label) {
    if (!button || !button.userData || !button.userData.text) return;
    button.userData.label = label;
    button.userData.text.setText(label);
  };

  BaseProto.setAllPointSizes = function (value) {
    for (const pc of this.viewer.scene.pointclouds) {
      if (pc.material) pc.material.size = value;
    }
  };

  BaseProto.getCurrentPointSize = function () {
    const pc = this.viewer.scene.pointclouds[0];
    if (pc && pc.material) return pc.material.size ?? 2.0;
    return 2.0;
  };

  BaseProto.getCurrentPointSizeTypeLabel = function () {
    const pc = this.viewer.scene.pointclouds[0];
    if (!pc || !pc.material) return 'Fixed';

    const t = pc.material.pointSizeType;
    if (t === PointSizeType.ATTENUATED) return 'Attenuated';
    if (t === PointSizeType.ADAPTIVE) return 'Adaptive';
    return 'Fixed';
  };

  BaseProto.cyclePointSizeType = function () {
    const pc = this.viewer.scene.pointclouds[0];
    if (!pc || !pc.material) return;

    const values = [PointSizeType.FIXED, PointSizeType.ATTENUATED, PointSizeType.ADAPTIVE];
    let index = values.indexOf(pc.material.pointSizeType);
    index = (index + 1) % values.length;
    const next = values[index];

    for (const cloud of this.viewer.scene.pointclouds) {
      if (cloud.material) cloud.material.pointSizeType = next;
    }

    this.refreshMenuState();
  };

  BaseProto.getBackgroundLabel = function () {
    const bg = this.viewer.background;
    if (bg === null) return 'None';
    if (bg === 'gradient') return 'Gradient';
    if (bg === 'skybox') return 'Skybox';
    if (bg === 'black') return 'Black';
    if (bg === 'white') return 'White';
    return `${bg}`;
  };

  BaseProto.cycleBackground = function () {
    const values = ['skybox', 'gradient', 'black', 'white', null];
    const current = this.viewer.background ?? null;
    let index = values.indexOf(current);
    index = (index + 1) % values.length;
    this.viewer.setBackground(values[index]);
    this.refreshMenuState();
  };

  BaseProto.refreshMenuState = function () {
    if (!this.menu || !this.menu.userData.controls) return;
    const controls = this.menu.userData.controls;

    if (controls.pointBudgetValue) {
      this.setButtonLabel(controls.pointBudgetValue, `Budget: ${Math.round(this.viewer.getPointBudget()).toLocaleString()}`);
    }
    if (controls.pointSizeValue) {
      this.setButtonLabel(controls.pointSizeValue, `Point size: ${this.getCurrentPointSize().toFixed(1)}`);
    }
    if (controls.pointSizeTypeValue) {
      this.setButtonLabel(controls.pointSizeTypeValue, `Size mode: ${this.getCurrentPointSizeTypeLabel()}`);
    }
    if (controls.backgroundValue) {
      this.setButtonLabel(controls.backgroundValue, `Background: ${this.getBackgroundLabel()}`);
    }
  };

  BaseProto.toggleMenu = function () {
    if (!this.menu) return;
    this.menuVisible = !this.menuVisible;
    this.menu.visible = this.menuVisible;

    if (this.menuVisible) {
      this.refreshMenuState();
      this.updateMenuPose();
    }
  };

  BaseProto.updateMenuPose = function () {
    if (!this.menu || !this.viewer || !this.viewer.renderer || !this.viewer.renderer.xr) return;

    const xrCam = this.viewer.renderer.xr.getCamera(fakeCam);
    if (!xrCam) return;

    xrCam.updateMatrixWorld(true);

    const headPos = xrCam.getWorldPosition(new THREE.Vector3());
    const headQuat = xrCam.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(headQuat).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(headQuat).normalize();

    const pos = headPos.clone()
      .add(forward.clone().multiplyScalar(0.82))
      .add(right.clone().multiplyScalar(0.20))
      .add(up.clone().multiplyScalar(-0.01));

    this.menu.position.copy(pos);
    this.menu.quaternion.copy(headQuat);
    this.menu.rotateY(Math.PI);
    this.menu.updateMatrix();
    this.menu.updateMatrixWorld(true);
  };

  BaseProto.handleMenuToggleInput = function () {
    const controller = this.cSecondary;
    if (!controller || !controller.inputSource || !controller.inputSource.gamepad) return;

    const gp = controller.inputSource.gamepad;
    const pressed =
      (gp.buttons[5] && gp.buttons[5].pressed) ||
      (gp.buttons[4] && gp.buttons[4].pressed);

    if (pressed && !this.menuPressLock) {
      this.menuPressLock = true;
      this.toggleMenu();
    }

    if (!pressed) {
      this.menuPressLock = false;
    }
  };

  BaseProto.updateMenuInteraction = function () {
    if (!this.menu || !this.menuVisible || !this.cPrimary) return;

    const controller = this.cPrimary;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);

    controller.updateMatrixWorld(true);
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();

    this.tmpRaycaster.set(origin, direction);
    this.tmpRaycaster.near = 0.01;
    this.tmpRaycaster.far = 2.0;

    const meshes = this.menuButtons.map(b => b.userData.bg);
    const intersections = this.tmpRaycaster.intersectObjects(meshes, false);

    if (this.menuHovered) {
      this.menuHovered.material.color.setHex(0x223344);
      this.menuHovered = null;
    }

    if (intersections.length > 0) {
      const hit = intersections[0].object;
      hit.material.color.setHex(0x66aaff);
      this.menuHovered = hit;
    }
  };

  BaseProto.pressHoveredButton = function () {
    if (!this.menuHovered) return false;
    const button = this.menuButtons.find(b => b.userData.bg === this.menuHovered);
    if (button && button.userData.onClick) {
      button.userData.onClick();
      return true;
    }
    return false;
  };

  BaseProto.initMenu = function (controller) {
    ensureExternalState(this);
    if (this.menu) return;

    this.menuController = controller;

    const node = new THREE.Object3D();
    node.name = 'vr menu';
    node.visible = false;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.50),
      new THREE.MeshBasicMaterial({
        color: 0x0f1b24,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    node.add(panel);

    const title = new Potree.TextSprite('POTREE VR');
    this.configureMenuTextSprite(title, {
      fontface: 'Arial',
      fontsize: 36,
      scale: 0.050,
    });
    title.position.set(0, 0.19, 0.004);
    node.add(title);

    const controls = {};

    const addSection = (label, y) => {
      const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.042),
        new THREE.MeshBasicMaterial({
          color: 0x30424e,
          transparent: true,
          opacity: 1.0,
          side: THREE.DoubleSide,
          depthTest: false,
        })
      );
      bg.position.set(0, y, 0.001);
      node.add(bg);

      const text = new Potree.TextSprite(label);
      this.configureMenuTextSprite(text, {
        fontface: 'Arial',
        fontsize: 30,
        scale: 0.044,
      });
      text.position.set(0, y, 0.004);
      node.add(text);
    };

    addSection('APPEARANCE', 0.12);

    controls.pointBudgetMinus = this.createMenuButton('-', -0.22, 0.05, 0.05, 0.038, () => {
      const v = Math.max(1000000, this.viewer.getPointBudget() - 1000000);
      this.viewer.setPointBudget(v);
      this.refreshMenuState();
    });
    controls.pointBudgetValue = this.createMenuButton('Budget: 0', 0.00, 0.05, 0.30, 0.040, () => {});
    controls.pointBudgetPlus = this.createMenuButton('+', 0.22, 0.05, 0.05, 0.038, () => {
      const v = Math.min(50000000, this.viewer.getPointBudget() + 1000000);
      this.viewer.setPointBudget(v);
      this.refreshMenuState();
    });

    controls.pointSizeMinus = this.createMenuButton('-', -0.22, -0.01, 0.05, 0.038, () => {
      const s = Math.max(0.5, this.getCurrentPointSize() - 0.1);
      this.setAllPointSizes(s);
      this.refreshMenuState();
    });
    controls.pointSizeValue = this.createMenuButton('Point size: 0', 0.00, -0.01, 0.30, 0.040, () => {});
    controls.pointSizePlus = this.createMenuButton('+', 0.22, -0.01, 0.05, 0.038, () => {
      const s = Math.min(10, this.getCurrentPointSize() + 0.1);
      this.setAllPointSizes(s);
      this.refreshMenuState();
    });

    controls.pointSizeTypeValue = this.createMenuButton('Size mode: Fixed', 0.00, -0.08, 0.42, 0.042, () => {
      this.cyclePointSizeType();
    });

    controls.backgroundValue = this.createMenuButton('Background: gradient', 0.00, -0.15, 0.42, 0.042, () => {
      this.cycleBackground();
    });

    for (const key of Object.keys(controls)) {
      node.add(controls[key]);
    }

    node.userData.controls = controls;
    this.viewer.sceneVR.add(node);
    node.scale.set(0.72, 0.72, 0.72);

    this.menu = node;
    window.vrMenu = node;
    this.refreshMenuState();
  };

  BaseProto.onTriggerStart = function (controller) {
    if (this.menuVisible && controller === this.cPrimary) {
      const consumed = this.pressHoveredButton();
      if (consumed) return;
    }

    this.triggered.add(controller);

    if (this.triggered.size === 0) {
      this.setMode(this.mode_fly);
    } else if (this.triggered.size === 1) {
      this.setMode(this.mode_translate);
    } else if (this.triggered.size === 2) {
      this.setMode(this.mode_rotScale);
    }
  };

  BaseProto.onStart = function () {
    ensureExternalState(this);

    const position = this.viewer.scene.view.position.clone();
    const direction = this.viewer.scene.view.direction.clone().multiplyScalar(-1);
    const target = position.clone().add(direction);
    target.z = position.z;

    const scale = this.viewer.getMoveSpeed();
    this.node.position.copy(position);
    this.node.lookAt(target);
    this.node.scale.set(scale, scale, scale);
    this.node.updateMatrix();
    this.node.updateMatrixWorld();

    this.menuVisible = true;
    if (this.menu) {
      this.menu.visible = true;
      this.refreshMenuState();
      this.updateMenuPose();
    }
  };

  BaseProto.onEnd = function () {
    if (this.menu) {
      this.menu.visible = false;
    }
  };

  BaseProto.update = function (delta) {
    ensureExternalState(this);

    this.handleMenuToggleInput();

    if (this.menu) this.updateMenuPose();
    if (this.menuVisible) this.updateMenuInteraction();

    if (this.triggered && this.triggered.size === 0) {
      applyExternalFly(this, delta);
      return;
    }

    if (this.mode && typeof this.mode.update === 'function') {
      this.mode.update(this, delta);
    }
  };

  window.PotreeExternalVR = {
    version: '1.0.0',
    patchTarget: 'Potree.VRControls.prototype',
  };

  console.info('[VR external] Full VR patch loaded.');
})();
