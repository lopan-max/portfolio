import { fetchJSON, renderProjects } from '../global.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const projects = await fetchJSON('../lib/projects.json');

const projectsTitle = document.querySelector('.projects-title');
projectsTitle.textContent = `Projects (${projects.length})`;

const projectsContainer = document.querySelector('.projects');

renderProjects(projects, projectsContainer, 'h2');

let query = '';
let selectedIndex = -1;
let selectedYear = null;

let searchInput = document.querySelector('.searchBar');

function matchesQuery(project) {
  let values = Object.values(project).join('\n').toLowerCase();
  return values.includes(query.toLowerCase());
}

function projectsForPie() {
  return projects.filter(matchesQuery);
}

function projectsToShow() {
  return projectsForPie().filter(
    (project) => selectedYear === null || project.year === selectedYear,
  );
}

function renderPieChart(projectsGiven) {
  let newRolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year,
  );

  let newData = newRolledData.map(([year, count]) => {
    return { value: count, label: year };
  });

  let newSliceGenerator = d3.pie().value((d) => d.value);
  let newArcData = newSliceGenerator(newData);
  let arcGenerator = d3.arc().innerRadius(0).outerRadius(50);
  let newArcs = newArcData.map((d) => arcGenerator(d));

  let colors = d3.scaleOrdinal(d3.schemeTableau10);

  let newSVG = d3.select('svg');
  newSVG.selectAll('path').remove();

  let legend = d3.select('.legend');
  legend.selectAll('li').remove();

  selectedIndex = selectedYear
    ? newData.findIndex((d) => d.label === selectedYear)
    : -1;

  function showProjectsForSelection() {
    newSVG
      .selectAll('path')
      .attr('class', (_, idx) => (idx === selectedIndex ? 'selected' : null));

    legend
      .selectAll('li')
      .attr('class', (_, idx) =>
        idx === selectedIndex ? 'legend-item selected' : 'legend-item',
      );

    renderProjects(projectsToShow(), projectsContainer, 'h2');
  }

  function selectYear(year) {
    selectedYear = selectedYear === year ? null : year;
    selectedIndex = selectedYear
      ? newData.findIndex((d) => d.label === selectedYear)
      : -1;
    showProjectsForSelection();
  }

  newArcs.forEach((arc, i) => {
    newSVG
      .append('path')
      .attr('d', arc)
      .attr('fill', colors(i))
      .attr('class', i === selectedIndex ? 'selected' : null)
      .on('click', () => {
        selectYear(newData[i].label);
      });
  });

  newData.forEach((d, idx) => {
    legend
      .append('li')
      .attr('class', idx === selectedIndex ? 'legend-item selected' : 'legend-item')
      .attr('style', `--color:${colors(idx)}`)
      .on('click', () => {
        selectYear(d.label);
      })
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`);
  });
}

renderPieChart(projects);

searchInput.addEventListener('change', (event) => {
  query = event.target.value;

  renderProjects(projectsToShow(), projectsContainer, 'h2');
  renderPieChart(projectsForPie());
});
