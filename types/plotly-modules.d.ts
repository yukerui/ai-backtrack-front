declare module "react-plotly.js/factory" {
  const createPlotlyComponent: (plotly: any) => any;
  export default createPlotlyComponent;
}

declare module "plotly.js-basic-dist-min" {
  const plotly: any;
  export default plotly;
}
