// 故意违规的夹具（T-ARC-1）：引擎里导入 React。正常 lint 忽略这个目录；
// 测试把它当作 packages/engine/src/ 下的文件来检查，必须被依赖方向规则拦下。
import { useState } from 'react';

export const leak = useState;
