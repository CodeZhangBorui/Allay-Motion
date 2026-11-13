// T-ENG-3：不透明白色矩形（宽 300、高 200 设计单位），每帧向右平移 200 设计单位；t = 0.05 时中心在 x = −600
export default {
  setup(ctx) {
    const { THREE, scene, stage } = ctx;
    const rect = new THREE.Mesh(new THREE.PlaneGeometry(300, 200), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    scene.add(rect);
    const speed = 200 * stage.fps;
    return {
      duration: 1,
      cutTime: null,
      update(t) {
        rect.position.x = -600 + speed * (t - 0.05);
      },
    };
  },
};
