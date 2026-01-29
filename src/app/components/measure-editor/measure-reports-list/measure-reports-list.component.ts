// Author: Preston Lee

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-measure-reports-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './measure-reports-list.component.html',
  styleUrl: './measure-reports-list.component.scss'
})
export class MeasureReportsListComponent {}
