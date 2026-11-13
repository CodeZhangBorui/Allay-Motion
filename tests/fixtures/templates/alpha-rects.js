// T-ENG-2：透明底上一个 50% 不透明的纯白矩形、一个不透明的纯红矩形（默认正交相机）
export default {
  setup(ctx) {
    const { THREE, scene } = ctx;
    const white = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
    white.position.set(-400, 0, 0);
    const red = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshBasicMaterial({ color: '#ff0000' }));
    red.position.set(400, 0, 0);
    scene.add(white, red);
    return { duration: 1, cutTime: null, update() {} };
  },
};
