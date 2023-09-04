---
layout: post
title: "Generating domain-driven code"
date: 2023-05-09 12:00:00 +01:00
author: "Tomas Ekeli"
permalink: 2020/05/generating-domain-driven-code/
categories: [code, domain-driven-design]
---

![A black car in a very clean garage with two red doors](/assets/img/2023-05-09-generating-domin-driven-code.png)

With the advent of large-language-models (LLMs) like Chat-GPT we can get some good help in getting started with our code. I like to use tools like this to get me going – then, with a base I can modify and evolve the code. It is somewhat like having a very knowledgeable, slightly distracted colleague help you.

I work with the [Dolittle SDK](https://dolittle.io/) daily, and in it i make (usually) event-sourced systems with a domain-driven approach. That’s a lot of jargon, but it boils down to

- capture the domain-terms and use them in the code
- encapsulate any changes as events
- create an “aggregate-root” that encapsulates the business-rules and makes sure all changes leave the system in a sane state
- process events to create read-models optimised for views

Since this is fairly formulaic, and we can tell large-language-models the rules for the parts in the system and how to make them – we can now prime such a model to create the important parts and just give it a description of the domain.

The results are, frankly, _staggering_!

One prompt I gave a [primed](https://gist.github.com/TomasEkeli/d222a3b6a521d251f2c7f088912298e9) model (using Chat-GPT 4 in this instance) was

> **Tomas:** write a domain where we are a garage, registering when customers bring their cars in for fixups. we need to be able to register appointments in business hours with the employees on shift – each employee works 8 hours and can work on one car at a time. store the read-models in a repository that is injected into the event-handler.

What came back was a set of events, and aggregate a repository and an event-handler in C# that would actually do what I told it:

> **ChatGPT:** We’ll create a domain for a garage with the following events: AppointmentScheduled, AppointmentStarted, and AppointmentCompleted. We’ll have a Garage aggregate root and a GarageHandler event handler. We’ll also create a read-model Appointment and an IAppointmentRepository to store appointments.

```csharp
using System;
using Dolittle.SDK.Aggregates;
using Dolittle.SDK.Events;
using Dolittle.SDK.Events.Handling;
using Microsoft.Extensions.Logging;

[EventType("1c1efda5-5a1c-4df7-9c84-72e7f3d2bbca")]
public record AppointmentScheduled(
  Guid AppointmentId,
  string LicensePlate,
  DateTimeOffset AppointmentTime,
  string Employee);

[EventType("1d34267e-0598-4e6f-b33b-153d6c4b6fa4")]
public record AppointmentStarted(Guid AppointmentId);

[EventType("f8fd8407-2c2f-4a6f-80c3-25e241d9c7e1")]
public record AppointmentCompleted(Guid AppointmentId);

[AggregateRoot("d6e31b8c-7edf-4ec9-9766-4c39398c7b1a")]
public class Garage : AggregateRoot
{
  public void ScheduleAppointment(
    Guid appointmentId,
    string licensePlate,
    DateTimeOffset appointmentTime,
    string employee)
  {
    // Validate appointment time (during business hours)</em>
    if (appointmentTime.Hour < 9 || appointmentTime.Hour >= 17)
    {
      throw new ArgumentOutOfRangeException(
        nameof(appointmentTime),
        "Appointments can only be scheduled during business "+
        "hours (9 AM - 5 PM)."
        );
    }

    Apply(new AppointmentScheduled(
      appointmentId,
      licensePlate,
      appointmentTime,
      employee));
  }

  public void StartAppointment(Guid appointmentId)
  {
    Apply(new AppointmentStarted(appointmentId));
  }

  public void CompleteAppointment(Guid appointmentId)
  {
    Apply(new AppointmentCompleted(appointmentId));
  }
}

public class Appointment
{
  public Guid AppointmentId { get; set; }
  public string LicensePlate { get; set; }
  public DateTimeOffset AppointmentTime { get; set; }
  public string Employee { get; set; }
  public bool InProgress { get; set; }
  public bool Completed { get; set; }
}

public interface IAppointmentRepository
{
  void Add(Appointment appointment);
  Appointment GetById(Guid appointmentId);
  void Update(Appointment appointment);
}

[EventHandler("9e6f0b74-7586-4d6c-8e0d-6e5ca5e5d5d5")]
public class GarageHandler
{
  readonly ILogger<GarageHandler> _logger;
  readonly IAppointmentRepository _appointmentRepository;

  public GarageHandler(
    ILogger<GarageHandler> logger,
    IAppointmentRepository appointmentRepository)
  {
    _logger = logger;
    _appointmentRepository = appointmentRepository;
  }

  public void Handle(AppointmentScheduled evt, EventContext eventContext)
  {
    var appointment = new Appointment
    {
      AppointmentId = evt.AppointmentId,
      LicensePlate = evt.LicensePlate,
      AppointmentTime = evt.AppointmentTime,
      Employee = evt.Employee,
      InProgress = false,
      Completed = false
    };

    _appointmentRepository.Add(appointment);
    _logger.LogInformation(
      "Appointment scheduled for {LicensePlate} at {AppointmentTime} "+
      "with employee {Employee}.",
      evt.LicensePlate,
      evt.AppointmentTime,
      evt.Employee);
  }

  public void Handle(AppointmentStarted evt, EventContext eventContext)
  {
    var appointment = _appointmentRepository.GetById(evt.AppointmentId);
    if (appointment != null)
    {
      appointment.InProgress = true;
      _appointmentRepository.Update(appointment);
      _logger.LogInformation(
        "Appointment with ID {AppointmentId} for {LicensePlate} has started.",
        evt.AppointmentId,
        appointment.LicensePlate);
    }
    else
    {
      _logger.LogError(
          "Couldn't find appointment with ID {AppointmentId} to start.",
          evt.AppointmentId);
    }
  }

  public void Handle(AppointmentCompleted evt, EventContext eventContext)
  {
    var appointment = _appointmentRepository.GetById(evt.AppointmentId);
    if (appointment != null)
    {
      appointment.InProgress = false;
      appointment.Completed = true;
      _appointmentRepository.Update(appointment);
      _logger.LogInformation(
        "Appointment with ID {AppointmentId} for {LicensePlate} has been "+
        "completed.",
        evt.AppointmentId,
        appointment.LicensePlate);
    }
    else
    {
      _logger.LogError(
        "Couldn't find appointment with ID {AppointmentId} to complete.",
        evt.AppointmentId);
    }
  }
}
```

This is all in one chunk of C# (it stopped in the middle of the `AppointmentStarted` -handling, but a simple “continue” produced the remainder of the code). Yes there are parts that are a little simple, and it hasn’t done any of the dependency injection or other needed things _but it wasn’t asked to_!

This is passable code to get any coder started with a using the Dolittle SDK, creating the important parts. To me, that is an amazing result!

After this was generated I tried asking it to include availability-checks on the employees in the garage:

> **Tomas:** modify the aggregate to register employees at work, and make sure the appointments are only accepted if the employee is available

and it gave the following response:

> **ChatGPT:** To register employees and make sure appointments are only accepted if the employee is available, we’ll create two new events: EmployeeRegistered and EmployeeShiftEnded. We’ll also modify the Garage aggregate root to store employees’ availability, and check for availability before scheduling an appointment.

```csharp
using System;
using System.Collections.Generic;
using Dolittle.SDK.Aggregates;
using Dolittle.SDK.Events;
using Dolittle.SDK.Events.Handling;
using Microsoft.Extensions.Logging;

// ... (other event records)

[EventType("258a90f7-6b54-47ea-8f1d-4473b3dd3b0d")]
public record EmployeeRegistered(string Employee);

[EventType("bbcd3f6d-8e3d-4c57-b6a0-6a9a17b39e6c")]
public record EmployeeShiftEnded(string Employee);

[AggregateRoot("d6e31b8c-7edf-4ec9-9766-4c39398c7b1a")]
public class Garage : AggregateRoot
{
Dictionary<string, bool> _employeeAvailability = new Dictionary<string, bool>();

// ... (other methods)

public void RegisterEmployee(string employee)
{
  if (!_employeeAvailability.ContainsKey(employee))
  {
    Apply(new EmployeeRegistered(employee));
  }
}

public void EndEmployeeShift(string employee)
{
  if (_employeeAvailability.ContainsKey(employee)
    && _employeeAvailability[employee])
  {
    Apply(new EmployeeShiftEnded(employee));
  }
}

public void ScheduleAppointment(
  Guid appointmentId,
  string licensePlate,
  DateTimeOffset appointmentTime,
  string employee)
{
  // Validate appointment time (during business hours)
  if (appointmentTime.Hour < 9 || appointmentTime.Hour >= 17)
  {
    throw new ArgumentOutOfRangeException(
      nameof(appointmentTime),
      "Appointments can only be scheduled during business hours "+
      "(9 AM - 5 PM).");
  }

  // Check if employee is available
  if (!_employeeAvailability.ContainsKey(employee)
    || !_employeeAvailability[employee])
  {
    throw new InvalidOperationException(
      $"Employee {employee} is not available for the appointment.");
  }

  Apply(new AppointmentScheduled(
    appointmentId,
    licensePlate,
    appointmentTime,
    employee));
}

void On(EmployeeRegistered @event)
  => _employeeAvailability[@event.Employee] = true;

void On(EmployeeShiftEnded @event)
  => _employeeAvailability[@event.Employee] = false;
}

// ... (GarageHandler, Appointment, IAppointmentRepository)
```

Here it has added some new events and changed the `ScheduleAppointment` -method to keep the system consistent. It chose to store the state of the employee in such a way that the employee is either available or not, but it has no concept of time-slots or anything like that.

This tells me that even though we can get a great start with our code using these models we still have to be able to read and understand the code they make. The bug here isn’t particularly subtle, and some basic testing would find it.

Let’s ask it to honour time-slots and working-times:

> **Tomas:** employees can only work on one car at the same time, and each car is assumed to take two hours. make sure an employee is not booked on two cars at the same time, and also add a half-an-hour grace-period at the end of every appointment for the employee to get ready for the next car.
>
> Employees are registered for shifts with a date and a from, and to time – and are only available in this time.
>
> An employee cannot be registered for more than 8 hours every day, or more than 40 hours in a week.

This produces for us some changes to the aggregate that will indeed work as specified:

> **ChatGPT:** To implement the requirements, we’ll modify the EmployeeRegistered event to include the shift date, start time, and end time. We’ll also create a new EmployeeWorkSchedule class to manage employee availability and work hours constraints. Finally, we’ll update the Garage aggregate root to use the EmployeeWorkSchedule class.

```csharp
using System;
using System.Collections.Generic;
using Dolittle.SDK.Aggregates;
using Dolittle.SDK.Events;
using Dolittle.SDK.Events.Handling;
using Microsoft.Extensions.Logging;

// ... (other event records)

[EventType("258a90f7-6b54-47ea-8f1d-4473b3dd3b0d")]
public record EmployeeRegistered(
  string Employee,
  DateTimeOffset ShiftDate,
  TimeSpan StartTime,
  TimeSpan EndTime);

// ... (other records and classes)

public class EmployeeWorkSchedule
{
  public string Employee { get; set; }
  public DateTimeOffset ShiftDate { get; set; }
  public TimeSpan StartTime { get; set; }
  public TimeSpan EndTime { get; set; }
}

public class EmployeeWorkHourException : Exception
{
  public EmployeeWorkHourException(string message) : base(message)
  {
  }
}

[AggregateRoot("d6e31b8c-7edf-4ec9-9766-4c39398c7b1a")]
public class Garage : AggregateRoot
{
  Dictionary<string, List<EmployeeWorkSchedule>> _employeeSchedules =
    new Dictionary<string, List<EmployeeWorkSchedule>>();

  // ... (other methods)

  public void RegisterEmployee(
    string employee,
    DateTimeOffset shiftDate,
    TimeSpan startTime,
    TimeSpan endTime)
  {
    ValidateEmployeeWorkHours(employee, shiftDate, startTime, endTime);

    Apply(new EmployeeRegistered(employee, shiftDate, startTime, endTime));
  }

  private void ValidateEmployeeWorkHours(
    string employee,
    DateTimeOffset shiftDate,
    TimeSpan startTime,
    TimeSpan endTime)
  {
    if (!_employeeSchedules.ContainsKey(employee))
    {
      _employeeSchedules[employee] = new List<EmployeeWorkSchedule>();
    }

    var dailyTotal = new TimeSpan();
    var weeklyTotal = new TimeSpan();

    var shiftDuration = endTime - startTime;

    if (shiftDuration.TotalHours > 8)
    {
      throw new EmployeeWorkHourException(
        "An employee cannot be registered for more than 8 hours per day.");
    }

    foreach (var shift in _employeeSchedules[employee])
    {
      if (shift.ShiftDate.Date == shiftDate.Date)
      {
        dailyTotal += shift.EndTime - shift.StartTime;
      }
      if (shift.ShiftDate.Date >= shiftDate.AddDays(-6).Date &&
        shift.ShiftDate.Date <= shiftDate.Date)
      {
        weeklyTotal += shift.EndTime - shift.StartTime;
      }
    }

    if (dailyTotal + shiftDuration > TimeSpan.FromHours(8))
    {
      throw new EmployeeWorkHourException(
        "An employee cannot be registered for more than 8 hours per day.");
    }

    if (weeklyTotal + shiftDuration > TimeSpan.FromHours(40))
    {
      throw new EmployeeWorkHourException(
        "An employee cannot be registered for more than 40 hours per week.");
    }
  }

  // ... (other On methods)

  void On(EmployeeRegistered @event)
  {
    if (!_employeeSchedules.ContainsKey(@event.Employee))
    {
      _employeeSchedules[@event.Employee] = new List<EmployeeWorkSchedule>();
    }
    _employeeSchedules[@event.Employee].Add(new EmployeeWorkSchedule
    {
        Employee = @event.Employee,
        ShiftDate = @event.ShiftDate,
        StartTime = @event.StartTime,
        EndTime = @event.EndTime
    });
  }
}
```

> **ChatGPT:** Now the `Garageaggregate` root can register employees with their shift dates, start times, and end times. `TheValidateEmployeeWorkHours` method checks if the employee work hours constraints are satisfied before registering the employee for a shift.
>
> Next, we’ll update the ScheduleAppointment method to ensure the employee is not booked for two cars at the same time, and each car is assumed to take two hours. We’ll also add a half-an-hour grace period at the end of every appointment.

```csharp
public class AppointmentOverlapException : Exception
{
  public AppointmentOverlapException(string message) : base(message)
  {
  }
}

[AggregateRoot("d6e31b8c-7edf-4ec9-9766-4c39398c7b1a")]
public class Garage : AggregateRoot
{
    // ... (other properties and methods)
  public void ScheduleAppointment(
    Guid appointmentId,
    string licensePlate,
    DateTimeOffset appointmentTime,
    string employee)
  {
    // Validate appointment time (during business hours)
    if (appointmentTime.Hour < 9 || appointmentTime.Hour >= 17)
    {
      throw new ArgumentOutOfRangeException(
        nameof(appointmentTime),
        "Appointments can only be scheduled during business hours (9 AM - 5 PM).");
    }

    // Validate if employee is available for the appointment
    if (!IsEmployeeAvailableForAppointment(employee, appointmentTime))
    {
      throw new AppointmentOverlapException(
        $"Employee {employee} is not available for the appointment.");
    }

    Apply(new AppointmentScheduled(
      appointmentId,
      licensePlate,
      appointmentTime,
      employee));
  }

  private bool IsEmployeeAvailableForAppointment(
    string employee,
    DateTimeOffset appointmentTime)
  {
    if (!_employeeSchedules.ContainsKey(employee))
    {
      return false;
    }

    var scheduleForDay = _employeeSchedules[employee]
      .Find(s => s.ShiftDate.Date == appointmentTime.Date);

    if (scheduleForDay == null)
    {
      return false;
    }

    // Check if the appointment is within the employee's shift
    if (appointmentTime.TimeOfDay < scheduleForDay.StartTime
      || appointmentTime.TimeOfDay >= scheduleForDay.EndTime)
    {
      return false;
    }

    // Check if the employee has enough time to work on the car (2 hours) and have a
    // grace period (30 minutes) before the shift ends
    if (appointmentTime.TimeOfDay +
      TimeSpan.FromHours(2) +
      TimeSpan.FromMinutes(30) > scheduleForDay.EndTime)
    {
      return false;
    }

    // Check for overlapping appointments
    foreach (var appointment in
      _appointmentRepository.GetAppointmentsByEmployee(employee))
    {
      if (appointment.AppointmentTime <= appointmentTime
        && appointmentTime < appointment.AppointmentTime + TimeSpan.FromHours(2.5))
      {
        return false;
      }
    }

    return true;
}
```

> **ChatGPT:** Now the ScheduleAppointment method checks if the employee is available for the appointment, considering the appointment duration and the grace period. The IsEmployeeAvailableForAppointment method verifies that the employee is not booked for two cars at the same time.

This is quite impressive to me. The code produced was remarkably readable and straightforward.

At the end-stretch there in the checking for overlapping appointments the model starts to use an `_appointmentRepository` that has not been defined in the `Garage` -aggregate, so that part doesn’t compile. The way we write aggregates with the Dolittle SDK doesn’t use repositories, they replay all their events at initialization, but that detail was lost on the model.

We also lack tests and the infrastructure around this domain to expose it (through a web-service, probably) and the database that the repository should use, but this is 80% of the way to a working, event-sourced garage-application with the Dolittle SDK!

It actually took me far longer to write this post and format the code for viewing on the web than it took to get the code. We are certainly living in interesting times!

Huge thanks to Magne Helleborg for the prompt to prime the model with!