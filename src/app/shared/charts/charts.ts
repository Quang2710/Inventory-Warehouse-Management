import type { Provider } from '@angular/core';
import { provideEchartsCore } from 'ngx-echarts';

/**
 * ECharts nạp lười, chỉ gồm các phần dùng tới (cột, đường, lưới, tooltip, markLine/markArea,
 * canvas) — chunk riêng chỉ tải khi mở màn báo cáo có biểu đồ.
 */
async function loadEcharts() {
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]);
  core.use([
    charts.BarChart,
    charts.LineChart,
    components.GridComponent,
    components.TooltipComponent,
    components.MarkLineComponent,
    components.MarkAreaComponent,
    components.AriaComponent,
    renderers.CanvasRenderer,
  ]);
  return core;
}

export function provideCharts(): Provider {
  return provideEchartsCore({ echarts: loadEcharts });
}

/**
 * Màu biểu đồ theo vai trò (tham chiếu bảng màu dataviz đã kiểm định CVD):
 * - `series`: 3 slot đầu của bảng categorical — hợp lệ với mọi cặp ở cả sáng & tối.
 * - chữ / lưới dùng màu trung tính, không dùng màu series.
 */
export interface ChartTheme {
  series: readonly [string, string, string];
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

export function chartTheme(dark: boolean): ChartTheme {
  return dark
    ? {
        series: ['#3987e5', '#d95926', '#199e70'],
        text: '#f0efec',
        muted: '#c3c2b7',
        grid: '#3a3a38',
        surface: '#1a1a19',
      }
    : {
        series: ['#2a78d6', '#eb6834', '#1baf7a'],
        text: '#0b0b0b',
        muted: '#52514e',
        grid: '#e4e3df',
        surface: '#fcfcfb',
      };
}
