// T-DEV-2：结果依赖调用顺序（update 里改了跨帧的状态）。不用任何被拦截的 API，只有双渲比对能发现
export default {
  setup(ctx) {
    const { THREE, scene, stage } = ctx;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(stage.width / 4, stage.height / 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(mesh);
    let calls = 0;
    return {
      duration: 1,
      cutTime: 0.5,
      update() {
        calls += 1;
        mesh.position.x = ((calls % 7) - 3) * 100;
      },
    };
  },
};
